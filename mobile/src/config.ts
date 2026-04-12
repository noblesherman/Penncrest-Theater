const PRODUCTION_API_BASE_URL = 'https://api.penncresttheater.com';
const PRODUCTION_WEB_BASE_URL = 'https://www.penncresttheater.com';

const apiBaseUrlFromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const terminalMockModeFromEnv = process.env.EXPO_PUBLIC_TERMINAL_MOCK_MODE?.trim().toLowerCase();
const privacyPolicyUrlFromEnv = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim();
const termsOfUseUrlFromEnv = process.env.EXPO_PUBLIC_TERMS_OF_USE_URL?.trim();
const refundPolicyUrlFromEnv = process.env.EXPO_PUBLIC_REFUND_POLICY_URL?.trim();
const supportUrlFromEnv = process.env.EXPO_PUBLIC_SUPPORT_URL?.trim();
const deviceHeartbeatMsFromEnv = process.env.EXPO_PUBLIC_DEVICE_HEARTBEAT_MS?.trim();
const deviceCommandPollWaitMsFromEnv = process.env.EXPO_PUBLIC_DEVICE_COMMAND_POLL_WAIT_MS?.trim();
const deviceCommandRetryBaseMsFromEnv = process.env.EXPO_PUBLIC_DEVICE_COMMAND_RETRY_BASE_MS?.trim();
const deviceAppVersionNameFromEnv = process.env.EXPO_PUBLIC_DEVICE_APP_VERSION_NAME?.trim();
const deviceAppVersionCodeFromEnv = process.env.EXPO_PUBLIC_DEVICE_APP_VERSION_CODE?.trim();

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function sanitizeApiBaseUrl(value: string | undefined): string {
  const raw = (value || PRODUCTION_API_BASE_URL).replace(/\/+$/, '');
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return PRODUCTION_API_BASE_URL;
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local');

  // Production builds should never point at local/non-TLS hosts.
  if (!__DEV__ && (parsed.protocol !== 'https:' || isLocalHost)) {
    return PRODUCTION_API_BASE_URL;
  }

  return parsed.origin;
}

export const API_BASE_URL = sanitizeApiBaseUrl(apiBaseUrlFromEnv);
export const TERMINAL_MOCK_MODE = __DEV__ && (terminalMockModeFromEnv === 'true' || terminalMockModeFromEnv === '1');
const webBaseUrl = PRODUCTION_WEB_BASE_URL.replace(/\/+$/, '');

export const PRIVACY_POLICY_URL = privacyPolicyUrlFromEnv || `${webBaseUrl}/privacy-policy`;
export const TERMS_OF_USE_URL = termsOfUseUrlFromEnv || `${webBaseUrl}/terms-of-service`;
export const REFUND_POLICY_URL = refundPolicyUrlFromEnv || `${webBaseUrl}/refund-policy`;
export const SUPPORT_URL = supportUrlFromEnv || 'mailto:jsmith3@rtmsd.org';
export const DEVICE_HEARTBEAT_MS = parseBoundedInt(deviceHeartbeatMsFromEnv, 15_000, 5_000, 60_000);
export const DEVICE_COMMAND_POLL_WAIT_MS = parseBoundedInt(deviceCommandPollWaitMsFromEnv, 25_000, 1_000, 30_000);
export const DEVICE_COMMAND_RETRY_BASE_MS = parseBoundedInt(deviceCommandRetryBaseMsFromEnv, 3_000, 500, 30_000);
export const DEVICE_APP_VERSION_NAME = deviceAppVersionNameFromEnv || '0.0.0';
export const DEVICE_APP_VERSION_CODE = parseBoundedInt(deviceAppVersionCodeFromEnv, 1, 1, 10_000_000);
