const ORDER_ACCESS_STORAGE_KEY = 'theater_order_access_tokens_v1';

function readStoredTokens(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(ORDER_ACCESS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStoredTokens(tokens: Record<string, string>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(ORDER_ACCESS_STORAGE_KEY, JSON.stringify(tokens));
}

export function rememberOrderAccessToken(orderId: string, token: string | null | undefined): void {
  if (!orderId || !token) {
    return;
  }

  const tokens = readStoredTokens();
  tokens[orderId] = token;
  writeStoredTokens(tokens);
}

export function getRememberedOrderAccessToken(orderId: string | null): string | null {
  if (!orderId) {
    return null;
  }

  const tokens = readStoredTokens();
  return tokens[orderId] || null;
}

export function buildConfirmationPath(orderId: string, token?: string | null): string {
  const params = new URLSearchParams({ orderId });
  if (token) {
    params.set('token', token);
  }

  return `/confirmation?${params.toString()}`;
}

export function buildCheckoutThankYouPath(orderId: string, token?: string | null): string {
  const params = new URLSearchParams({ orderId });
  if (token) {
    params.set('token', token);
  }

  return `/checkout-thank-you?${params.toString()}`;
}
