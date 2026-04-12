import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
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

function signMetadata(secret: string, canonical: string): string {
  return crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
}

const schemaName = `device_mgmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend integration tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_device_management';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_device_management';
process.env.JWT_SECRET = 'device-management-secret-12345';
process.env.ADMIN_USERNAME = 'device-admin';
process.env.ADMIN_PASSWORD = 'device-admin-password';
process.env.MOBILE_APP_UPDATE_ALLOWED_HOSTS = 'downloads.example.com';
process.env.MOBILE_RELEASE_METADATA_SIGNING_SECRET = 'device-management-signing-secret';
process.env.MOBILE_ADMIN_PIN_MAX_ATTEMPTS = '2';
process.env.MOBILE_ADMIN_PIN_LOCK_MINUTES = '1';
process.env.MOBILE_ADMIN_UNLOCK_WINDOW_SECONDS = '300';
process.env.MOBILE_DEVICE_TOKEN_TTL = '30d';

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;

let adminToken: string;
let boxOfficeToken: string;

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`
  };
}

async function registerDevice(params?: { deviceId?: string; installationId?: string; displayName?: string }) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/mobile/device/register',
    headers: authHeaders(adminToken),
    payload: {
      deviceId: params?.deviceId || 'android-kiosk-001',
      installationId: params?.installationId || 'install-001',
      displayName: params?.displayName || 'Lobby Kiosk',
      platform: 'android'
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json() as {
    device: {
      id: string;
      deviceId: string;
      installationId: string;
      displayName: string | null;
    };
    deviceToken: string;
  };
}

describe.sequential('device management integration', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL
      },
      stdio: 'pipe'
    });

    ({ prisma } = await import('../lib/prisma.js'));
    ({ createServer } = await import('../server.js'));

    app = await createServer();

    const adminUser = await prisma.adminUser.create({
      data: {
        username: 'device-admin-user',
        name: 'Device Admin',
        passwordHash: 'not-used',
        role: 'ADMIN',
        isActive: true
      }
    });

    const boxOfficeUser = await prisma.adminUser.create({
      data: {
        username: 'device-box-office-user',
        name: 'Device Box Office',
        passwordHash: 'not-used',
        role: 'BOX_OFFICE',
        isActive: true
      }
    });

    adminToken = await app.jwt.sign({
      role: 'admin',
      adminId: adminUser.id,
      adminRole: adminUser.role,
      username: adminUser.username
    });

    boxOfficeToken = await app.jwt.sign({
      role: 'admin',
      adminId: boxOfficeUser.id,
      adminRole: boxOfficeUser.role,
      username: boxOfficeUser.username
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.managedDeviceEvent.deleteMany();
    await prisma.managedDeviceCommand.deleteMany();
    await prisma.managedDevice.deleteMany();
    await prisma.mobileAppRelease.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  it('registers a managed device, issues token, and accepts heartbeat updates', async () => {
    const registered = await registerDevice();

    const heartbeatResponse = await app.inject({
      method: 'POST',
      url: '/api/mobile/device/heartbeat',
      headers: authHeaders(registered.deviceToken),
      payload: {
        deviceId: registered.device.deviceId,
        installationId: registered.device.installationId,
        appVersionName: '1.2.3',
        appVersionCode: 123,
        kioskLocked: true,
        maintenanceMode: false,
        deviceOwnerActive: true,
        updateState: 'IDLE'
      }
    });

    expect(heartbeatResponse.statusCode).toBe(200);
    expect(heartbeatResponse.json().ok).toBe(true);

    const dbDevice = await prisma.managedDevice.findUniqueOrThrow({
      where: { id: registered.device.id }
    });

    expect(dbDevice.appVersionName).toBe('1.2.3');
    expect(dbDevice.appVersionCode).toBe(123);
    expect(dbDevice.kioskLocked).toBe(true);
    expect(dbDevice.deviceOwnerActive).toBe(true);
    expect(dbDevice.isOnline).toBe(true);
  });

  it('runs command queue lifecycle pending -> delivered -> succeeded and handles timeout', async () => {
    const registered = await registerDevice({
      deviceId: 'android-kiosk-002',
      installationId: 'install-002'
    });

    const queueResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/devices/${encodeURIComponent(registered.device.id)}/commands`,
      headers: authHeaders(adminToken),
      payload: {
        type: 'REFRESH_CONFIG',
        payload: {
          source: 'integration-test'
        }
      }
    });

    expect(queueResponse.statusCode).toBe(201);
    const commandId = queueResponse.json().command.id as string;

    const nextResponse = await app.inject({
      method: 'POST',
      url: '/api/mobile/device/commands/next',
      headers: authHeaders(registered.deviceToken),
      payload: {
        waitMs: 0
      }
    });

    expect(nextResponse.statusCode).toBe(200);
    expect(nextResponse.json().command.id).toBe(commandId);
    expect(nextResponse.json().command.status).toBe('DELIVERED');

    const ackResponse = await app.inject({
      method: 'POST',
      url: `/api/mobile/device/commands/${encodeURIComponent(commandId)}/ack`,
      headers: authHeaders(registered.deviceToken),
      payload: {
        status: 'SUCCEEDED',
        result: {
          refreshedAt: new Date().toISOString()
        }
      }
    });

    expect(ackResponse.statusCode).toBe(200);
    expect(ackResponse.json().command.status).toBe('SUCCEEDED');

    const timeoutQueue = await app.inject({
      method: 'POST',
      url: `/api/admin/devices/${encodeURIComponent(registered.device.id)}/commands`,
      headers: authHeaders(adminToken),
      payload: {
        type: 'UPDATE_APP',
        claimTimeoutSeconds: 1
      }
    });

    expect(timeoutQueue.statusCode).toBe(201);
    const timeoutCommandId = timeoutQueue.json().command.id as string;

    const timeoutNext = await app.inject({
      method: 'POST',
      url: '/api/mobile/device/commands/next',
      headers: authHeaders(registered.deviceToken),
      payload: {
        waitMs: 0
      }
    });

    expect(timeoutNext.statusCode).toBe(200);
    expect(timeoutNext.json().command.id).toBe(timeoutCommandId);

    await new Promise((resolve) => {
      setTimeout(resolve, 1_250);
    });

    const timeoutAck = await app.inject({
      method: 'POST',
      url: `/api/mobile/device/commands/${encodeURIComponent(timeoutCommandId)}/ack`,
      headers: authHeaders(registered.deviceToken),
      payload: {
        status: 'SUCCEEDED'
      }
    });

    expect(timeoutAck.statusCode).toBe(200);
    expect(timeoutAck.json().command.status).toBe('TIMEOUT');
  });

  it('denies BOX_OFFICE role from admin device control endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/devices',
      headers: authHeaders(boxOfficeToken)
    });

    expect(response.statusCode).toBe(403);
  });

  it('validates update metadata host/hash/signature and accepts valid signed metadata', async () => {
    const invalidHostResponse = await app.inject({
      method: 'PUT',
      url: '/api/admin/devices/update-metadata',
      headers: authHeaders(adminToken),
      payload: {
        versionName: '2.0.0',
        versionCode: 200,
        apkUrl: 'https://malicious.example.net/releases/app.apk',
        apkSha256: 'a'.repeat(64),
        forceUpdate: false
      }
    });

    expect(invalidHostResponse.statusCode).toBe(400);

    const invalidHashResponse = await app.inject({
      method: 'PUT',
      url: '/api/admin/devices/update-metadata',
      headers: authHeaders(adminToken),
      payload: {
        versionName: '2.0.1',
        versionCode: 201,
        apkUrl: 'https://downloads.example.com/releases/app.apk',
        apkSha256: '1234'
      }
    });

    expect(invalidHashResponse.statusCode).toBe(400);

    const unsignedPayload = {
      versionName: '2.0.2',
      versionCode: 202,
      apkUrl: 'https://downloads.example.com/releases/app.apk',
      apkSha256: 'b'.repeat(64),
      apkSizeBytes: 123456,
      forceUpdate: true,
      releaseNotes: 'Integration test release'
    };

    const invalidSignatureResponse = await app.inject({
      method: 'PUT',
      url: '/api/admin/devices/update-metadata',
      headers: authHeaders(adminToken),
      payload: {
        ...unsignedPayload,
        metadataSignature: 'invalid-signature'
      }
    });

    expect(invalidSignatureResponse.statusCode).toBe(400);

    const signature = signMetadata(
      process.env.MOBILE_RELEASE_METADATA_SIGNING_SECRET!,
      canonicalReleaseMetadata(unsignedPayload)
    );

    const validResponse = await app.inject({
      method: 'PUT',
      url: '/api/admin/devices/update-metadata',
      headers: authHeaders(adminToken),
      payload: {
        ...unsignedPayload,
        metadataSignature: signature
      }
    });

    expect(validResponse.statusCode).toBe(200);
    expect(validResponse.json().release.versionCode).toBe(202);

    const latestResponse = await app.inject({
      method: 'GET',
      url: '/api/mobile/device/update/latest',
      headers: authHeaders((await registerDevice({ deviceId: 'android-kiosk-003', installationId: 'install-003' })).deviceToken)
    });

    expect(latestResponse.statusCode).toBe(200);
    expect(latestResponse.json().release.versionCode).toBe(202);
  });

  it('enforces PIN verify lockout after repeated failures', async () => {
    const registered = await registerDevice({
      deviceId: 'android-kiosk-004',
      installationId: 'install-004'
    });

    const setPinResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/devices/${encodeURIComponent(registered.device.id)}/pin`,
      headers: authHeaders(adminToken),
      payload: {
        pin: '2468'
      }
    });

    expect(setPinResponse.statusCode).toBe(200);

    const firstFailure = await app.inject({
      method: 'POST',
      url: '/api/mobile/device/admin-unlock/verify',
      headers: authHeaders(registered.deviceToken),
      payload: {
        pin: '0000'
      }
    });

    expect(firstFailure.statusCode).toBe(401);
    expect(firstFailure.json().remainingAttempts).toBe(1);

    const secondFailure = await app.inject({
      method: 'POST',
      url: '/api/mobile/device/admin-unlock/verify',
      headers: authHeaders(registered.deviceToken),
      payload: {
        pin: '0000'
      }
    });

    expect(secondFailure.statusCode).toBe(423);
    expect(secondFailure.json().ok).toBe(false);

    const blockedValidAttempt = await app.inject({
      method: 'POST',
      url: '/api/mobile/device/admin-unlock/verify',
      headers: authHeaders(registered.deviceToken),
      payload: {
        pin: '2468'
      }
    });

    expect(blockedValidAttempt.statusCode).toBe(423);
  });
});
