import { Linking, NativeModules, Platform } from 'react-native';

type NativeDeviceControlModule = {
  isDeviceOwner: () => Promise<boolean>;
  setKioskLock: (locked: boolean) => Promise<boolean>;
  openWifiSettings: () => Promise<void>;
  openAppSettings: () => Promise<void>;
  restartApp: () => Promise<void>;
  downloadAndInstallApk: (
    apkUrl: string,
    expectedSha256: string
  ) => Promise<{
    installed: boolean;
    mode: 'silent' | 'installer_intent' | 'unsupported';
    message?: string;
  }>;
  getDeviceInfo: () => Promise<{
    model: string;
    manufacturer?: string;
    osVersion: string;
    deviceName?: string;
  }>;
};

const nativeModule = NativeModules.DeviceControlModule as NativeDeviceControlModule | undefined;

async function openSystemSettingsFallback(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    await Linking.openSettings();
  } catch {
    // No fallback available.
  }
}

export async function isDeviceOwner(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.isDeviceOwner();
}

export async function setKioskLock(locked: boolean): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.setKioskLock(locked);
}

export async function openWifiSettings(): Promise<void> {
  if (!nativeModule) {
    await openSystemSettingsFallback();
    return;
  }

  await nativeModule.openWifiSettings();
}

export async function openAppSettings(): Promise<void> {
  if (!nativeModule) {
    await openSystemSettingsFallback();
    return;
  }

  await nativeModule.openAppSettings();
}

export async function restartApp(): Promise<void> {
  if (!nativeModule) {
    return;
  }

  await nativeModule.restartApp();
}

export async function downloadAndInstallApk(apkUrl: string, expectedSha256: string): Promise<{
  installed: boolean;
  mode: 'silent' | 'installer_intent' | 'unsupported';
  message?: string;
}> {
  if (!nativeModule) {
    return {
      installed: false,
      mode: 'unsupported',
      message: 'Native installer module not available'
    };
  }

  return nativeModule.downloadAndInstallApk(apkUrl, expectedSha256);
}

export async function getDeviceInfo(): Promise<{
  model: string;
  manufacturer?: string;
  osVersion: string;
  deviceName?: string;
}> {
  if (!nativeModule) {
    return {
      model: 'unknown',
      manufacturer: 'unknown',
      osVersion: Platform.Version ? String(Platform.Version) : 'unknown',
      deviceName: 'unknown'
    };
  }

  return nativeModule.getDeviceInfo();
}
