import { FastifyPluginAsync } from 'fastify';
import { ManagedDeviceCommandStatus, ManagedDeviceUpdateState } from '@prisma/client';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { logAudit } from '../lib/audit-log.js';
import { handleRouteError } from '../lib/route-error.js';
import {
  acknowledgeManagedDeviceCommand,
  claimNextManagedDeviceCommand,
  getLatestMobileAppRelease,
  heartbeatManagedDevice,
  registerManagedDevice,
  verifyManagedDevicePin
} from '../services/device-management-service.js';

const registerSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  installationId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(120).optional(),
  platform: z.string().trim().max(40).optional(),
  model: z.string().trim().max(120).optional(),
  osVersion: z.string().trim().max(80).optional()
});

const heartbeatSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  installationId: z.string().trim().min(1).max(200),
  appVersionName: z.string().trim().max(120).optional(),
  appVersionCode: z.coerce.number().int().min(0).optional(),
  kioskLocked: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  deviceOwnerActive: z.boolean().optional(),
  updateState: z.nativeEnum(ManagedDeviceUpdateState).optional(),
  lastCommandId: z.string().trim().min(1).max(200).optional(),
  lastCommandStatus: z.nativeEnum(ManagedDeviceCommandStatus).optional()
});

const commandNextSchema = z.object({
  waitMs: z.coerce.number().int().min(0).max(30_000).optional()
});

const commandAckSchema = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED', 'TIMEOUT', 'CANCELED']),
  failureReason: z.string().trim().max(500).optional(),
  result: z.unknown().optional()
});

const adminUnlockVerifySchema = z.object({
  pin: z.string().trim().min(4).max(16)
});

export const mobileDeviceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/mobile/device/register', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const device = await registerManagedDevice({
        ...parsed.data,
        registeredByAdminId: request.adminUser?.id || null
      });

      const token = await reply.jwtSign(
        {
          role: 'mobile_device',
          managedDeviceId: device.id,
          deviceId: device.deviceId,
          tokenVersion: device.tokenVersion
        },
        {
          expiresIn: env.MOBILE_DEVICE_TOKEN_TTL
        }
      );

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'MOBILE_DEVICE_REGISTER',
        entityType: 'ManagedDevice',
        entityId: device.id,
        metadata: {
          deviceId: device.deviceId,
          installationId: device.installationId,
          displayName: device.displayName
        }
      });

      return reply.send({
        device: {
          id: device.id,
          deviceId: device.deviceId,
          installationId: device.installationId,
          displayName: device.displayName,
          platform: device.platform,
          maintenanceMode: device.maintenanceMode,
          kioskLocked: device.kioskLocked,
          updateState: device.updateState
        },
        deviceToken: token
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to register managed device');
    }
  });

  app.post('/api/mobile/device/heartbeat', { preHandler: app.authenticateManagedDevice }, async (request, reply) => {
    const parsed = heartbeatSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const managedDevice = request.managedDevice!;
    if (parsed.data.deviceId !== managedDevice.deviceId) {
      return reply.status(400).send({ error: 'deviceId does not match device token' });
    }

    try {
      const updated = await heartbeatManagedDevice({
        managedDeviceId: managedDevice.id,
        ...parsed.data
      });

      await logAudit({
        actor: `device:${managedDevice.deviceId}`,
        action: 'MOBILE_DEVICE_HEARTBEAT',
        entityType: 'ManagedDevice',
        entityId: managedDevice.id,
        metadata: {
          installationId: parsed.data.installationId,
          appVersionName: parsed.data.appVersionName || null,
          appVersionCode: parsed.data.appVersionCode ?? null,
          kioskLocked: parsed.data.kioskLocked ?? null,
          maintenanceMode: parsed.data.maintenanceMode ?? null,
          updateState: parsed.data.updateState || null
        }
      });

      return reply.send({
        ok: true,
        serverTime: new Date().toISOString(),
        state: {
          maintenanceMode: updated.maintenanceMode,
          kioskLocked: updated.kioskLocked,
          updateState: updated.updateState
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to process heartbeat');
    }
  });

  app.post('/api/mobile/device/commands/next', { preHandler: app.authenticateManagedDevice }, async (request, reply) => {
    const parsed = commandNextSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const command = await claimNextManagedDeviceCommand({
        managedDeviceId: request.managedDevice!.id,
        waitMs: parsed.data.waitMs
      });

      if (!command) {
        return reply.send({ command: null });
      }

      return reply.send({
        command: {
          id: command.id,
          type: command.type,
          payload: command.payload,
          status: command.status,
          claimExpiresAt: command.claimExpiresAt?.toISOString() || null,
          createdAt: command.createdAt.toISOString()
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch next command');
    }
  });

  app.post('/api/mobile/device/commands/:id/ack', { preHandler: app.authenticateManagedDevice }, async (request, reply) => {
    const parsedBody = commandAckSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    const parsedParams = z.object({ id: z.string().trim().min(1) }).safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const command = await acknowledgeManagedDeviceCommand({
        managedDeviceId: request.managedDevice!.id,
        commandId: parsedParams.data.id,
        status: parsedBody.data.status,
        failureReason: parsedBody.data.failureReason,
        result: parsedBody.data.result
      });

      await logAudit({
        actor: `device:${request.managedDevice!.deviceId}`,
        action: 'MOBILE_DEVICE_COMMAND_ACK',
        entityType: 'ManagedDeviceCommand',
        entityId: command.id,
        metadata: {
          status: command.status,
          failureReason: command.failureReason || null
        }
      });

      return reply.send({
        command: {
          id: command.id,
          status: command.status,
          acknowledgedAt: command.acknowledgedAt?.toISOString() || null,
          completedAt: command.completedAt?.toISOString() || null
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to acknowledge command');
    }
  });

  app.get('/api/mobile/device/update/latest', { preHandler: app.authenticateManagedDevice }, async (_request, reply) => {
    try {
      const release = await getLatestMobileAppRelease();
      if (!release) {
        return reply.send({ release: null });
      }

      return reply.send({
        release: {
          versionName: release.versionName,
          versionCode: release.versionCode,
          apkUrl: release.apkUrl,
          apkSha256: release.apkSha256,
          apkSizeBytes: release.apkSizeBytes,
          forceUpdate: release.forceUpdate,
          releaseNotes: release.releaseNotes,
          metadataSignature: release.metadataSignature
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch release metadata');
    }
  });

  app.post(
    '/api/mobile/device/admin-unlock/verify',
    {
      preHandler: app.authenticateManagedDevice,
      config: {
        rateLimit: {
          max: 25,
          timeWindow: '5 minutes'
        }
      }
    },
    async (request, reply) => {
      const parsed = adminUnlockVerifySchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const result = await verifyManagedDevicePin({
          managedDeviceId: request.managedDevice!.id,
          pin: parsed.data.pin,
          maxAttempts: env.MOBILE_ADMIN_PIN_MAX_ATTEMPTS,
          lockMinutes: env.MOBILE_ADMIN_PIN_LOCK_MINUTES
        });

        await logAudit({
          actor: `device:${request.managedDevice!.deviceId}`,
          action: 'MOBILE_DEVICE_ADMIN_UNLOCK_VERIFY',
          entityType: 'ManagedDevice',
          entityId: request.managedDevice!.id,
          metadata: {
            ok: result.ok,
            lockedUntil: result.lockedUntil || null,
            remainingAttempts: result.remainingAttempts ?? null
          }
        });

        if (!result.ok) {
          return reply.status(result.lockedUntil ? 423 : 401).send({
            ok: false,
            lockedUntil: result.lockedUntil,
            remainingAttempts: result.remainingAttempts ?? 0
          });
        }

        return reply.send({
          ok: true,
          unlockWindowSeconds: env.MOBILE_ADMIN_UNLOCK_WINDOW_SECONDS,
          remainingAttempts: result.remainingAttempts ?? env.MOBILE_ADMIN_PIN_MAX_ATTEMPTS
        });
      } catch (err) {
        handleRouteError(reply, err, 'Failed to verify admin unlock PIN');
      }
    }
  );
};
