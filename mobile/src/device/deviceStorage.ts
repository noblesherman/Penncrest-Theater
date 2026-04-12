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
