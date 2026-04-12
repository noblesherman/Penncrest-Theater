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
