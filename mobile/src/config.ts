const PRODUCTION_API_BASE_URL = 'https://api.penncresttheater.com';
const PRODUCTION_WEB_BASE_URL = 'https://www.penncresttheater.com';

const apiBaseUrlFromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const terminalMockModeFromEnv = process.env.EXPO_PUBLIC_TERMINAL_MOCK_MODE?.trim().toLowerCase();
const privacyPolicyUrlFromEnv = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim();
const termsOfUseUrlFromEnv = process.env.EXPO_PUBLIC_TERMS_OF_USE_URL?.trim();
const refundPolicyUrlFromEnv = process.env.EXPO_PUBLIC_REFUND_POLICY_URL?.trim();
const supportUrlFromEnv = process.env.EXPO_PUBLIC_SUPPORT_URL?.trim();

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
