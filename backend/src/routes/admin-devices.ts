import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { ManagedDeviceCommandType } from '@prisma/client';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { logAudit } from '../lib/audit-log.js';
import { handleRouteError } from '../lib/route-error.js';
import {
  getLatestMobileAppRelease,
  getManagedDeviceDetailForAdmin,
  listManagedDevicesForAdmin,
  queueManagedDeviceCommand,
  setManagedDevicePin,
  updateManagedDeviceDisplayName,
  upsertMobileAppRelease
} from '../services/device-management-service.js';

const deviceIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const queueCommandSchema = z.object({
  type: z.nativeEnum(ManagedDeviceCommandType),
  payload: z.unknown().optional(),
  claimTimeoutSeconds: z.coerce.number().int().min(1).max(900).optional()
});

const setPinSchema = z.object({
  pin: z.string().trim().min(4).max(16)
});

const setDisplayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(120)
});

const updateMetadataSchema = z.object({
  versionName: z.string().trim().min(1).max(64),
  versionCode: z.coerce.number().int().min(1),
  apkUrl: z.string().url(),
  apkSha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, 'apkSha256 must be a 64-char hex SHA-256 digest'),
  apkSizeBytes: z.coerce.number().int().positive().optional(),
  forceUpdate: z.boolean().optional(),
  releaseNotes: z.string().trim().max(4000).optional(),
  metadataSignature: z.string().trim().min(16).max(512).optional()
});

function parseAllowedHosts(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(hostname: string, allowList: string[]): boolean {
  if (allowList.length === 0) {
    return true;
  }

  const host = hostname.toLowerCase();
  return allowList.some((rule) => {
    if (rule.startsWith('*.')) {
      const base = rule.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }

    return host === rule;
  });
}

function canonicalReleaseMetadata(input: {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  apkSha256: string;
  apkSizeBytes?: number;
  forceUpdate?: boolean;
  releaseNotes?: string;
}): string {
  return [
    input.versionName,
    String(input.versionCode),
    input.apkUrl,
    input.apkSha256.toLowerCase(),
    String(input.apkSizeBytes ?? 0),
    input.forceUpdate ? '1' : '0',
    input.releaseNotes || ''
  ].join('|');
}

function createMetadataSignature(secret: string, canonical: string): string {
  return crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
}

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

export const adminDeviceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/devices', { preHandler: app.requireAdminRole('ADMIN') }, async (_request, reply) => {
    try {
      const [rows, release] = await Promise.all([listManagedDevicesForAdmin(), getLatestMobileAppRelease()]);

      return reply.send({
        release: release
          ? {
              versionName: release.versionName,
              versionCode: release.versionCode,
              apkUrl: release.apkUrl,
              apkSha256: release.apkSha256,
              apkSizeBytes: release.apkSizeBytes,
              forceUpdate: release.forceUpdate,
              releaseNotes: release.releaseNotes,
              metadataSignature: release.metadataSignature,
              updatedAt: release.updatedAt.toISOString()
            }
          : null,
        devices: rows.map((row) => ({
          id: row.id,
          deviceId: row.deviceId,
          installationId: row.installationId,
          displayName: row.displayName,
          platform: row.platform,
          model: row.model,
          osVersion: row.osVersion,
          appVersionName: row.appVersionName,
          appVersionCode: row.appVersionCode,
          kioskLocked: row.kioskLocked,
          maintenanceMode: row.maintenanceMode,
          deviceOwnerActive: row.deviceOwnerActive,
          updateState: row.updateState,
          isOnline: row.isOnline,
          lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() || null,
          lastCommandId: row.lastCommandId,
          lastCommandStatus: row.lastCommandStatus,
          lastCommand: row.commands[0]
            ? {
                id: row.commands[0].id,
                type: row.commands[0].type,
                status: row.commands[0].status,
                createdAt: row.commands[0].createdAt.toISOString(),
                completedAt: row.commands[0].completedAt?.toISOString() || null
              }
            : null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to list managed devices');
    }
  });

  app.get('/api/admin/devices/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = deviceIdParamSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const device = await getManagedDeviceDetailForAdmin(parsedParams.data.id);
      return reply.send({
        device: {
          id: device.id,
          deviceId: device.deviceId,
          installationId: device.installationId,
          displayName: device.displayName,
          platform: device.platform,
          model: device.model,
          osVersion: device.osVersion,
          appVersionName: device.appVersionName,
          appVersionCode: device.appVersionCode,
          kioskLocked: device.kioskLocked,
          maintenanceMode: device.maintenanceMode,
          deviceOwnerActive: device.deviceOwnerActive,
          updateState: device.updateState,
          isOnline: device.isOnline,
          lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() || null,
          lastCommandId: device.lastCommandId,
          lastCommandStatus: device.lastCommandStatus,
          createdAt: device.createdAt.toISOString(),
          updatedAt: device.updatedAt.toISOString(),
          commands: device.commands.map((command) => ({
            id: command.id,
            type: command.type,
            status: command.status,
            payload: command.payload,
            claimTimeoutSeconds: command.claimTimeoutSeconds,
            claimedAt: command.claimedAt?.toISOString() || null,
            claimExpiresAt: command.claimExpiresAt?.toISOString() || null,
            acknowledgedAt: command.acknowledgedAt?.toISOString() || null,
            completedAt: command.completedAt?.toISOString() || null,
            failureReason: command.failureReason,
            createdAt: command.createdAt.toISOString()
          })),
          events: device.events.map((event) => ({
            id: event.id,
            actor: event.actor,
            actorId: event.actorId,
            eventType: event.eventType,
            metadata: event.metadata,
            createdAt: event.createdAt.toISOString()
          }))
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch managed device');
    }
  });

  app.post('/api/admin/devices/:id/commands', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = deviceIdParamSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = queueCommandSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      const command = await queueManagedDeviceCommand({
        managedDeviceId: parsedParams.data.id,
        type: parsedBody.data.type,
        payload: parsedBody.data.payload,
        claimTimeoutSeconds: parsedBody.data.claimTimeoutSeconds,
        createdByAdminId: request.adminUser?.id || null
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'MOBILE_DEVICE_COMMAND_QUEUED',
        entityType: 'ManagedDeviceCommand',
        entityId: command.id,
        metadata: {
          managedDeviceId: parsedParams.data.id,
          type: command.type,
          claimTimeoutSeconds: command.claimTimeoutSeconds
        }
      });

      return reply.status(201).send({
        command: {
          id: command.id,
          status: command.status,
          type: command.type,
          payload: command.payload,
          createdAt: command.createdAt.toISOString()
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to queue device command');
    }
  });

  app.post('/api/admin/devices/:id/pin', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = deviceIdParamSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = setPinSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      await setManagedDevicePin({
        managedDeviceId: parsedParams.data.id,
        pin: parsedBody.data.pin,
        actorAdminId: request.adminUser?.id || null
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'MOBILE_DEVICE_PIN_UPDATED',
        entityType: 'ManagedDevice',
        entityId: parsedParams.data.id
      });

      return reply.send({ ok: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to set managed device PIN');
    }
  });

  app.patch('/api/admin/devices/:id/name', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = deviceIdParamSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = setDisplayNameSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      const device = await updateManagedDeviceDisplayName({
        managedDeviceId: parsedParams.data.id,
        displayName: parsedBody.data.displayName,
        actorAdminId: request.adminUser?.id || null
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'MOBILE_DEVICE_NAME_UPDATED',
        entityType: 'ManagedDevice',
        entityId: parsedParams.data.id,
        metadata: {
          displayName: device.displayName
        }
      });

      return reply.send({
        device: {
          id: device.id,
          displayName: device.displayName
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update managed device name');
    }
  });

  app.put('/api/admin/devices/update-metadata', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedBody = updateMetadataSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      const update = parsedBody.data;
      const apkUrl = new URL(update.apkUrl);
      if (apkUrl.protocol !== 'https:') {
        return reply.status(400).send({ error: 'apkUrl must use https' });
      }

      const allowedHosts = parseAllowedHosts(env.MOBILE_APP_UPDATE_ALLOWED_HOSTS);
      if (!isAllowedHost(apkUrl.hostname, allowedHosts)) {
        return reply.status(400).send({ error: `apkUrl host is not allowed: ${apkUrl.hostname}` });
      }

      const canonical = canonicalReleaseMetadata(update);
      if (env.MOBILE_RELEASE_METADATA_SIGNING_SECRET) {
        if (!update.metadataSignature) {
          return reply.status(400).send({ error: 'metadataSignature is required for signed metadata' });
        }

        const expected = createMetadataSignature(env.MOBILE_RELEASE_METADATA_SIGNING_SECRET, canonical);
        if (!timingSafeEqualString(expected, update.metadataSignature)) {
          return reply.status(400).send({ error: 'Invalid metadataSignature' });
        }
      }

      const release = await upsertMobileAppRelease({
        ...update,
        actorAdminId: request.adminUser?.id || null
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'MOBILE_DEVICE_RELEASE_UPDATED',
        entityType: 'MobileAppRelease',
        entityId: release.id,
        metadata: {
          versionName: release.versionName,
          versionCode: release.versionCode,
          apkUrl: release.apkUrl,
          forceUpdate: release.forceUpdate
        }
      });

      return reply.send({
        release: {
          id: release.id,
          versionName: release.versionName,
          versionCode: release.versionCode,
          apkUrl: release.apkUrl,
          apkSha256: release.apkSha256,
          apkSizeBytes: release.apkSizeBytes,
          forceUpdate: release.forceUpdate,
          releaseNotes: release.releaseNotes,
          metadataSignature: release.metadataSignature,
          updatedAt: release.updatedAt.toISOString()
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update mobile release metadata');
    }
  });
};
