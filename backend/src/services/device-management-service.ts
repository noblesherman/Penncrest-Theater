import {
  ManagedDeviceCommandStatus,
  ManagedDeviceCommandType,
  ManagedDeviceUpdateState,
  type ManagedDevice,
  type ManagedDeviceCommand
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const DEVICE_ONLINE_WINDOW_MS = 70_000;
const COMMAND_CLAIM_POLL_INTERVAL_MS = 1_000;
const DEFAULT_COMMAND_CLAIM_TIMEOUT_SECONDS = 90;
const MAX_COMMAND_CLAIM_TIMEOUT_SECONDS = 900;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeDeviceValue(value: string): string {
  return value.trim();
}

function coerceClaimTimeoutSeconds(raw: number | null | undefined): number {
  if (!raw || !Number.isFinite(raw)) {
    return DEFAULT_COMMAND_CLAIM_TIMEOUT_SECONDS;
  }

  return Math.max(1, Math.min(MAX_COMMAND_CLAIM_TIMEOUT_SECONDS, Math.floor(raw)));
}

async function markStaleDevicesOffline(): Promise<void> {
  const cutoff = new Date(Date.now() - DEVICE_ONLINE_WINDOW_MS);
  await prisma.managedDevice.updateMany({
    where: {
      isOnline: true,
      lastHeartbeatAt: {
        lt: cutoff
      }
    },
    data: {
      isOnline: false
    }
  });
}

export async function expireTimedOutDeviceCommands(): Promise<number> {
  const now = new Date();
  const updated = await prisma.managedDeviceCommand.updateMany({
    where: {
      status: 'DELIVERED',
      claimExpiresAt: {
        lt: now
      }
    },
    data: {
      status: 'TIMEOUT',
      completedAt: now,
      failureReason: 'Command acknowledgement timeout'
    }
  });

  if (updated.count > 0) {
    const timedOutCommands = await prisma.managedDeviceCommand.findMany({
      where: {
        status: 'TIMEOUT',
        completedAt: now
      },
      select: {
        id: true,
        managedDeviceId: true
      }
    });

    if (timedOutCommands.length > 0) {
      await Promise.all(
        timedOutCommands.map((command) =>
          prisma.managedDevice.updateMany({
            where: { id: command.managedDeviceId },
            data: {
              lastCommandId: command.id,
              lastCommandStatus: 'TIMEOUT'
            }
          })
        )
      );
    }
  }

  return updated.count;
}

export async function recordManagedDeviceEvent(params: {
  managedDeviceId: string;
  eventType: string;
  actor: 'ADMIN' | 'DEVICE' | 'SYSTEM';
  actorId?: string | null;
  metadata?: unknown;
}): Promise<void> {
  await prisma.managedDeviceEvent.create({
    data: {
      managedDeviceId: params.managedDeviceId,
      eventType: params.eventType,
      actor: params.actor,
      actorId: params.actorId || null,
      metadata: (params.metadata ?? null) as any
    }
  });
}

export async function registerManagedDevice(params: {
  deviceId: string;
  installationId: string;
  displayName?: string;
  platform?: string;
  model?: string;
  osVersion?: string;
  registeredByAdminId?: string | null;
}): Promise<ManagedDevice> {
  const now = new Date();
  const deviceId = normalizeDeviceValue(params.deviceId);
  const installationId = normalizeDeviceValue(params.installationId);

  const device = await prisma.managedDevice.upsert({
    where: {
      deviceId
    },
    create: {
      deviceId,
      installationId,
      displayName: params.displayName?.trim() || null,
      platform: params.platform?.trim() || 'android',
      model: params.model?.trim() || null,
      osVersion: params.osVersion?.trim() || null,
      registeredByAdminId: params.registeredByAdminId || null,
      isOnline: true,
      lastHeartbeatAt: now
    },
    update: {
      installationId,
      platform: params.platform?.trim() || 'android',
      model: params.model?.trim() || null,
      osVersion: params.osVersion?.trim() || null,
      registeredByAdminId: params.registeredByAdminId || null,
      isOnline: true,
      lastHeartbeatAt: now,
      tokenVersion: {
        increment: 1
      }
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: device.id,
    actor: 'ADMIN',
    actorId: params.registeredByAdminId || null,
    eventType: 'DEVICE_REGISTERED',
    metadata: {
      deviceId,
      installationId,
      displayName: device.displayName || null
    }
  });

  return device;
}

export async function heartbeatManagedDevice(params: {
  managedDeviceId: string;
  installationId: string;
  appVersionName?: string;
  appVersionCode?: number;
  kioskLocked?: boolean;
  maintenanceMode?: boolean;
  deviceOwnerActive?: boolean;
  updateState?: ManagedDeviceUpdateState;
  lastCommandId?: string;
  lastCommandStatus?: ManagedDeviceCommandStatus;
}): Promise<ManagedDevice> {
  const now = new Date();

  const device = await prisma.managedDevice.update({
    where: {
      id: params.managedDeviceId
    },
    data: {
      installationId: params.installationId,
      appVersionName: params.appVersionName || null,
      appVersionCode: params.appVersionCode ?? null,
      kioskLocked: params.kioskLocked ?? undefined,
      maintenanceMode: params.maintenanceMode ?? undefined,
      deviceOwnerActive: params.deviceOwnerActive ?? undefined,
      updateState: params.updateState ?? undefined,
      lastCommandId: params.lastCommandId || undefined,
      lastCommandStatus: params.lastCommandStatus || undefined,
      isOnline: true,
      lastHeartbeatAt: now
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: device.id,
    actor: 'DEVICE',
    actorId: device.deviceId,
    eventType: 'HEARTBEAT',
    metadata: {
      installationId: params.installationId,
      appVersionName: params.appVersionName || null,
      appVersionCode: params.appVersionCode ?? null,
      kioskLocked: params.kioskLocked ?? null,
      maintenanceMode: params.maintenanceMode ?? null,
      deviceOwnerActive: params.deviceOwnerActive ?? null,
      updateState: params.updateState ?? null,
      lastCommandId: params.lastCommandId || null,
      lastCommandStatus: params.lastCommandStatus || null
    }
  });

  return device;
}

async function claimNextPendingCommandOnce(managedDeviceId: string): Promise<ManagedDeviceCommand | null> {
  const now = new Date();
  await expireTimedOutDeviceCommands();

  const next = await prisma.managedDeviceCommand.findFirst({
    where: {
      managedDeviceId,
      status: 'PENDING'
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  if (!next) {
    return null;
  }

  const claimTimeoutSeconds = coerceClaimTimeoutSeconds(next.claimTimeoutSeconds);
  const claimExpiresAt = new Date(now.getTime() + claimTimeoutSeconds * 1_000);

  const updated = await prisma.managedDeviceCommand.updateMany({
    where: {
      id: next.id,
      status: 'PENDING'
    },
    data: {
      status: 'DELIVERED',
      claimedAt: now,
      claimExpiresAt,
      updatedAt: now
    }
  });

  if (updated.count === 0) {
    return null;
  }

  const command = await prisma.managedDeviceCommand.findUnique({
    where: { id: next.id }
  });

  if (!command) {
    return null;
  }

  await prisma.managedDevice.updateMany({
    where: { id: managedDeviceId },
    data: {
      lastCommandId: command.id,
      lastCommandStatus: command.status
    }
  });

  return command;
}

export async function claimNextManagedDeviceCommand(params: {
  managedDeviceId: string;
  waitMs?: number;
}): Promise<ManagedDeviceCommand | null> {
  const maxWaitMs = Math.max(0, Math.min(30_000, Math.floor(params.waitMs || 0)));
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    const command = await claimNextPendingCommandOnce(params.managedDeviceId);
    if (command) {
      await recordManagedDeviceEvent({
        managedDeviceId: params.managedDeviceId,
        actor: 'DEVICE',
        eventType: 'COMMAND_DELIVERED',
        metadata: {
          commandId: command.id,
          commandType: command.type,
          claimExpiresAt: command.claimExpiresAt?.toISOString() || null
        }
      });
      return command;
    }

    if (Date.now() >= deadline) {
      return null;
    }

    await wait(COMMAND_CLAIM_POLL_INTERVAL_MS);
  }
}

export async function acknowledgeManagedDeviceCommand(params: {
  managedDeviceId: string;
  commandId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'CANCELED';
  result?: unknown;
  failureReason?: string | null;
}): Promise<ManagedDeviceCommand> {
  const now = new Date();
  await expireTimedOutDeviceCommands();

  const command = await prisma.managedDeviceCommand.findFirst({
    where: {
      id: params.commandId,
      managedDeviceId: params.managedDeviceId
    }
  });

  if (!command) {
    throw new HttpError(404, 'Managed device command not found');
  }

  if (['SUCCEEDED', 'FAILED', 'TIMEOUT', 'CANCELED'].includes(command.status)) {
    return command;
  }

  if (command.claimExpiresAt && command.claimExpiresAt.getTime() < now.getTime() && command.status === 'DELIVERED') {
    const timedOut = await prisma.managedDeviceCommand.update({
      where: { id: command.id },
      data: {
        status: 'TIMEOUT',
        acknowledgedAt: now,
        completedAt: now,
        failureReason: 'Acknowledgement received after command timeout',
        result: (params.result ?? null) as any
      }
    });

    await prisma.managedDevice.updateMany({
      where: { id: params.managedDeviceId },
      data: {
        lastCommandId: timedOut.id,
        lastCommandStatus: timedOut.status
      }
    });

    return timedOut;
  }

  if (command.status !== 'DELIVERED' && command.status !== 'PENDING') {
    throw new HttpError(409, `Command is not in an acknowledgeable state (${command.status})`);
  }

  const acknowledged = await prisma.managedDeviceCommand.update({
    where: {
      id: command.id
    },
    data: {
      status: params.status,
      acknowledgedAt: now,
      completedAt: now,
      failureReason: params.failureReason || null,
      result: (params.result ?? null) as any
    }
  });

  await prisma.managedDevice.updateMany({
    where: { id: params.managedDeviceId },
    data: {
      lastCommandId: acknowledged.id,
      lastCommandStatus: acknowledged.status
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: params.managedDeviceId,
    actor: 'DEVICE',
    eventType: 'COMMAND_ACKNOWLEDGED',
    metadata: {
      commandId: acknowledged.id,
      status: acknowledged.status,
      failureReason: acknowledged.failureReason || null
    }
  });

  return acknowledged;
}

export async function queueManagedDeviceCommand(params: {
  managedDeviceId: string;
  type: ManagedDeviceCommandType;
  payload?: unknown;
  claimTimeoutSeconds?: number;
  createdByAdminId?: string | null;
}): Promise<ManagedDeviceCommand> {
  const now = new Date();
  const claimTimeoutSeconds = coerceClaimTimeoutSeconds(params.claimTimeoutSeconds);

  const command = await prisma.managedDeviceCommand.create({
    data: {
      managedDeviceId: params.managedDeviceId,
      type: params.type,
      status: 'PENDING',
      payload: (params.payload ?? null) as any,
      createdByAdminId: params.createdByAdminId || null,
      claimTimeoutSeconds,
      createdAt: now,
      updatedAt: now
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: params.managedDeviceId,
    actor: 'ADMIN',
    actorId: params.createdByAdminId || null,
    eventType: 'COMMAND_QUEUED',
    metadata: {
      commandId: command.id,
      commandType: command.type,
      claimTimeoutSeconds
    }
  });

  return command;
}

export async function setManagedDevicePin(params: {
  managedDeviceId: string;
  pin: string;
  actorAdminId?: string | null;
}): Promise<void> {
  const pinHash = await hashPassword(params.pin.trim());

  await prisma.managedDevice.update({
    where: {
      id: params.managedDeviceId
    },
    data: {
      adminPinHash: pinHash,
      pinFailedAttempts: 0,
      pinLockedUntil: null
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: params.managedDeviceId,
    actor: 'ADMIN',
    actorId: params.actorAdminId || null,
    eventType: 'PIN_UPDATED'
  });
}

export async function updateManagedDeviceDisplayName(params: {
  managedDeviceId: string;
  displayName: string;
  actorAdminId?: string | null;
}): Promise<ManagedDevice> {
  const nextDisplayName = params.displayName.trim();

  const device = await prisma.managedDevice.update({
    where: {
      id: params.managedDeviceId
    },
    data: {
      displayName: nextDisplayName
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: params.managedDeviceId,
    actor: 'ADMIN',
    actorId: params.actorAdminId || null,
    eventType: 'DISPLAY_NAME_UPDATED',
    metadata: {
      displayName: nextDisplayName
    }
  });

  return device;
}

export async function verifyManagedDevicePin(params: {
  managedDeviceId: string;
  pin: string;
  maxAttempts: number;
  lockMinutes: number;
}): Promise<{
  ok: boolean;
  lockedUntil?: string;
  remainingAttempts?: number;
}> {
  const now = new Date();
  const device = await prisma.managedDevice.findUnique({
    where: {
      id: params.managedDeviceId
    },
    select: {
      id: true,
      deviceId: true,
      adminPinHash: true,
      pinFailedAttempts: true,
      pinLockedUntil: true
    }
  });

  if (!device) {
    throw new HttpError(404, 'Managed device not found');
  }

  if (!device.adminPinHash) {
    throw new HttpError(404, 'Admin PIN is not configured for this device');
  }

  if (device.pinLockedUntil && device.pinLockedUntil.getTime() > now.getTime()) {
    await recordManagedDeviceEvent({
      managedDeviceId: device.id,
      actor: 'DEVICE',
      actorId: device.deviceId,
      eventType: 'PIN_VERIFY_BLOCKED',
      metadata: {
        lockedUntil: device.pinLockedUntil.toISOString()
      }
    });

    return {
      ok: false,
      lockedUntil: device.pinLockedUntil.toISOString(),
      remainingAttempts: 0
    };
  }

  const isValid = await verifyPassword(params.pin, device.adminPinHash);

  if (isValid) {
    await prisma.managedDevice.update({
      where: { id: device.id },
      data: {
        pinFailedAttempts: 0,
        pinLockedUntil: null
      }
    });

    await recordManagedDeviceEvent({
      managedDeviceId: device.id,
      actor: 'DEVICE',
      actorId: device.deviceId,
      eventType: 'PIN_VERIFY_SUCCEEDED'
    });

    return {
      ok: true,
      remainingAttempts: params.maxAttempts
    };
  }

  const nextFailedAttempts = device.pinFailedAttempts + 1;
  const shouldLock = nextFailedAttempts >= params.maxAttempts;
  const lockUntil = shouldLock ? new Date(now.getTime() + Math.max(1, params.lockMinutes) * 60_000) : null;

  await prisma.managedDevice.update({
    where: {
      id: device.id
    },
    data: {
      pinFailedAttempts: shouldLock ? 0 : nextFailedAttempts,
      pinLockedUntil: lockUntil
    }
  });

  await recordManagedDeviceEvent({
    managedDeviceId: device.id,
    actor: 'DEVICE',
    actorId: device.deviceId,
    eventType: 'PIN_VERIFY_FAILED',
    metadata: {
      failedAttempts: shouldLock ? params.maxAttempts : nextFailedAttempts,
      lockedUntil: lockUntil?.toISOString() || null
    }
  });

  return {
    ok: false,
    lockedUntil: lockUntil?.toISOString(),
    remainingAttempts: shouldLock ? 0 : Math.max(0, params.maxAttempts - nextFailedAttempts)
  };
}

export async function getManagedDeviceById(id: string): Promise<ManagedDevice> {
  await markStaleDevicesOffline();

  const device = await prisma.managedDevice.findUnique({
    where: {
      id
    }
  });

  if (!device) {
    throw new HttpError(404, 'Managed device not found');
  }

  return device;
}

export async function listManagedDevicesForAdmin() {
  await markStaleDevicesOffline();

  return prisma.managedDevice.findMany({
    orderBy: [
      { isOnline: 'desc' },
      { lastHeartbeatAt: 'desc' },
      { createdAt: 'asc' }
    ],
    include: {
      commands: {
        orderBy: {
          createdAt: 'desc'
        },
        take: 1
      }
    }
  });
}

export async function getManagedDeviceDetailForAdmin(id: string) {
  await markStaleDevicesOffline();

  const device = await prisma.managedDevice.findUnique({
    where: {
      id
    },
    include: {
      commands: {
        orderBy: {
          createdAt: 'desc'
        },
        take: 25
      },
      events: {
        orderBy: {
          createdAt: 'desc'
        },
        take: 40
      }
    }
  });

  if (!device) {
    throw new HttpError(404, 'Managed device not found');
  }

  return device;
}

export async function upsertMobileAppRelease(params: {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  apkSha256: string;
  apkSizeBytes?: number | null;
  forceUpdate?: boolean;
  releaseNotes?: string;
  metadataSignature?: string;
  actorAdminId?: string | null;
}) {
  return prisma.mobileAppRelease.upsert({
    where: {
      channel: 'production'
    },
    create: {
      channel: 'production',
      versionName: params.versionName,
      versionCode: params.versionCode,
      apkUrl: params.apkUrl,
      apkSha256: params.apkSha256,
      apkSizeBytes: params.apkSizeBytes ?? null,
      forceUpdate: Boolean(params.forceUpdate),
      releaseNotes: params.releaseNotes || null,
      metadataSignature: params.metadataSignature || null,
      createdByAdminId: params.actorAdminId || null,
      updatedByAdminId: params.actorAdminId || null
    },
    update: {
      versionName: params.versionName,
      versionCode: params.versionCode,
      apkUrl: params.apkUrl,
      apkSha256: params.apkSha256,
      apkSizeBytes: params.apkSizeBytes ?? null,
      forceUpdate: Boolean(params.forceUpdate),
      releaseNotes: params.releaseNotes || null,
      metadataSignature: params.metadataSignature || null,
      updatedByAdminId: params.actorAdminId || null
    }
  });
}

export async function getLatestMobileAppRelease() {
  return prisma.mobileAppRelease.findUnique({
    where: {
      channel: 'production'
    }
  });
}
