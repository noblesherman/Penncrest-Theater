/*
Handoff note for Mr. Smith:
- File: `mobile/src/device/deviceStorage.ts`
- What this is: Mobile device/runtime control module.
- What it does: Handles managed-device commands, storage, update checks, and native bridge behavior.
- Connections: Used by startup/maintenance/terminal flows.
- Main content type: Runtime control logic rather than UI.
- Safe edits here: Diagnostics comments and careful additive safeguards.
- Be careful with: Command handling/state persistence changes that can lock or destabilize flows.
- Useful context: This area is naturally fragile; test real-device paths when behavior changes.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_RUNTIME_STORAGE_KEY = 'theater.mobile.deviceRuntime.v1';

export type PersistedDeviceRuntime = {
  deviceId: string;
  installationId: string;
  deviceToken: string | null;
  maintenanceMode: boolean;
  kioskLocked: boolean;
  updateState: string;
  lastCommandId: string | null;
};

function createRandomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDeviceIdentity(): Pick<PersistedDeviceRuntime, 'deviceId' | 'installationId'> {
  return {
    deviceId: createRandomId('device'),
    installationId: createRandomId('install')
  };
}

export async function loadPersistedDeviceRuntime(): Promise<PersistedDeviceRuntime | null> {
  const raw = await AsyncStorage.getItem(DEVICE_RUNTIME_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedDeviceRuntime>;
    if (!parsed.deviceId || !parsed.installationId) {
      return null;
    }

    return {
      deviceId: parsed.deviceId,
      installationId: parsed.installationId,
      deviceToken: parsed.deviceToken ?? null,
      maintenanceMode: Boolean(parsed.maintenanceMode),
      kioskLocked: Boolean(parsed.kioskLocked),
      updateState: typeof parsed.updateState === 'string' ? parsed.updateState : 'IDLE',
      lastCommandId: parsed.lastCommandId ?? null
    };
  } catch {
    return null;
  }
}

export async function savePersistedDeviceRuntime(runtime: PersistedDeviceRuntime): Promise<void> {
  await AsyncStorage.setItem(DEVICE_RUNTIME_STORAGE_KEY, JSON.stringify(runtime));
}
