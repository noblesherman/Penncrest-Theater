/*
Handoff note for Mr. Smith:
- File: `mobile/src/device/updateService.ts`
- What this is: Mobile device/runtime control module.
- What it does: Handles managed-device commands, storage, update checks, and native bridge behavior.
- Connections: Used by startup/maintenance/terminal flows.
- Main content type: Runtime control logic rather than UI.
- Safe edits here: Diagnostics comments and careful additive safeguards.
- Be careful with: Command handling/state persistence changes that can lock or destabilize flows.
- Useful context: This area is naturally fragile; test real-device paths when behavior changes.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { fetchLatestReleaseMetadata, type DeviceReleaseMetadata } from './deviceApi';
import { downloadAndInstallApk } from '../native/deviceControl';

export type UpdateCheckResult = {
  checked: boolean;
  updateAvailable: boolean;
  release: DeviceReleaseMetadata | null;
  installAttempted: boolean;
  installResult?: {
    installed: boolean;
    mode: 'silent' | 'installer_intent' | 'unsupported';
    message?: string;
  };
};

export async function checkForUpdateAndInstall(params: {
  deviceToken: string;
  currentVersionCode: number;
}): Promise<UpdateCheckResult> {
  const release = await fetchLatestReleaseMetadata(params.deviceToken);
  if (!release) {
    return {
      checked: true,
      updateAvailable: false,
      release: null,
      installAttempted: false
    };
  }

  const updateAvailable = release.versionCode > params.currentVersionCode;
  if (!updateAvailable && !release.forceUpdate) {
    return {
      checked: true,
      updateAvailable: false,
      release,
      installAttempted: false
    };
  }

  const installResult = await downloadAndInstallApk(release.apkUrl, release.apkSha256);

  return {
    checked: true,
    updateAvailable: true,
    release,
    installAttempted: true,
    installResult
  };
}
