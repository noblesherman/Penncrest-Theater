/*
Handoff note for Mr. Smith:
- File: `mobile/src/device/deviceApi.ts`
- What this is: Mobile device/runtime control module.
- What it does: Handles managed-device commands, storage, update checks, and native bridge behavior.
- Connections: Used by startup/maintenance/terminal flows.
- Main content type: Runtime control logic rather than UI.
- Safe edits here: Diagnostics comments and careful additive safeguards.
- Be careful with: Command handling/state persistence changes that can lock or destabilize flows.
- Useful context: This area is naturally fragile; test real-device paths when behavior changes.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { apiRequest } from '../api/client';

export type DeviceUpdateState = 'IDLE' | 'DOWNLOADING' | 'VERIFYING' | 'INSTALLING' | 'INSTALLED' | 'FAILED';

export type ManagedDeviceCommandType =
  | 'REFRESH_CONFIG'
  | 'RESTART_APP'
  | 'ENTER_MAINTENANCE'
  | 'EXIT_MAINTENANCE'
  | 'UPDATE_APP'
  | 'SET_KIOSK_LOCK';

export type ManagedDeviceCommand = {
  id: string;
  type: ManagedDeviceCommandType;
  payload: unknown;
  status: 'DELIVERED' | 'PENDING';
  claimExpiresAt: string | null;
  createdAt: string;
};

export type DeviceReleaseMetadata = {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  apkSha256: string;
  apkSizeBytes: number | null;
  forceUpdate: boolean;
  releaseNotes: string | null;
  metadataSignature: string | null;
};

export async function registerManagedDevice(
  adminToken: string,
  payload: {
    deviceId: string;
    installationId: string;
    displayName?: string;
    platform?: string;
    model?: string;
    osVersion?: string;
  }
): Promise<{ deviceToken: string }> {
  return apiRequest<{ deviceToken: string }>('/api/mobile/device/register', {
    method: 'POST',
    token: adminToken,
    body: payload
  });
}

export async function sendDeviceHeartbeat(
  deviceToken: string,
  payload: {
    deviceId: string;
    installationId: string;
    appVersionName: string;
    appVersionCode: number;
    kioskLocked: boolean;
    maintenanceMode: boolean;
    deviceOwnerActive: boolean;
    updateState: DeviceUpdateState;
    lastCommandId?: string | null;
  }
): Promise<{
  ok: boolean;
  serverTime: string;
  state: {
    maintenanceMode: boolean;
    kioskLocked: boolean;
    updateState: DeviceUpdateState;
  };
}> {
  return apiRequest('/api/mobile/device/heartbeat', {
    method: 'POST',
    token: deviceToken,
    body: payload
  });
}

export async function pollNextManagedDeviceCommand(
  deviceToken: string,
  waitMs: number
): Promise<{ command: ManagedDeviceCommand | null }> {
  return apiRequest<{ command: ManagedDeviceCommand | null }>('/api/mobile/device/commands/next', {
    method: 'POST',
    token: deviceToken,
    body: {
      waitMs
    }
  });
}

export async function acknowledgeManagedDeviceCommand(
  deviceToken: string,
  commandId: string,
  payload: {
    status: 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'CANCELED';
    failureReason?: string;
    result?: unknown;
  }
): Promise<void> {
  await apiRequest(`/api/mobile/device/commands/${encodeURIComponent(commandId)}/ack`, {
    method: 'POST',
    token: deviceToken,
    body: payload
  });
}

export async function fetchLatestReleaseMetadata(deviceToken: string): Promise<DeviceReleaseMetadata | null> {
  const response = await apiRequest<{ release: DeviceReleaseMetadata | null }>('/api/mobile/device/update/latest', {
    method: 'GET',
    token: deviceToken
  });

  return response.release;
}

export async function verifyAdminUnlockPin(deviceToken: string, pin: string): Promise<{
  ok: boolean;
  unlockWindowSeconds?: number;
  remainingAttempts?: number;
  lockedUntil?: string;
}> {
  return apiRequest('/api/mobile/device/admin-unlock/verify', {
    method: 'POST',
    token: deviceToken,
    body: {
      pin
    }
  });
}
