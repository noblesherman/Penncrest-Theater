/*
Handoff note for Mr. Smith:
- File: `mobile/src/native/deviceControl.ts`
- What this is: Mobile device/runtime control module.
- What it does: Handles managed-device commands, storage, update checks, and native bridge behavior.
- Connections: Used by startup/maintenance/terminal flows.
- Main content type: Runtime control logic rather than UI.
- Safe edits here: Diagnostics comments and careful additive safeguards.
- Be careful with: Command handling/state persistence changes that can lock or destabilize flows.
- Useful context: This area is naturally fragile; test real-device paths when behavior changes.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
  getBatteryStatus?: () => Promise<{
    level: number;
    isCharging: boolean;
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

export async function getBatteryStatus(): Promise<{
  level: number | null;
  isCharging: boolean;
} | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  if (!nativeModule?.getBatteryStatus) {
    return null;
  }

  try {
    const data = await nativeModule.getBatteryStatus();
    const normalizedLevel =
      Number.isFinite(data.level) && data.level >= 0
        ? Math.max(0, Math.min(100, Math.round(data.level)))
        : null;

    return {
      level: normalizedLevel,
      isCharging: Boolean(data.isCharging)
    };
  } catch {
    return null;
  }
}
