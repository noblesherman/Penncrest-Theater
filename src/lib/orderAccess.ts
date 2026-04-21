const ORDER_ACCESS_STORAGE_KEY = 'theater_order_access_tokens_v1';
const CHECKOUT_TRANSITION_STORAGE_KEY = 'theater_checkout_transition_v1';
const CHECKOUT_TRANSITION_TTL_MS = 45_000;

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

function readCheckoutTransitionMap(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_TRANSITION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeCheckoutTransitionMap(map: Record<string, number>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(CHECKOUT_TRANSITION_STORAGE_KEY, JSON.stringify(map));
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

export function markCheckoutTransitionPending(orderId: string): void {
  if (!orderId) {
    return;
  }

  const map = readCheckoutTransitionMap();
  map[orderId] = Date.now() + CHECKOUT_TRANSITION_TTL_MS;
  writeCheckoutTransitionMap(map);
}

export function consumeCheckoutTransition(orderId: string | null): boolean {
  if (!orderId) {
    return false;
  }

  const now = Date.now();
  const map = readCheckoutTransitionMap();
  let changed = false;

  for (const [key, expiresAt] of Object.entries(map)) {
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      delete map[key];
      changed = true;
    }
  }

  const shouldPlay = Boolean(map[orderId]);
  if (shouldPlay) {
    delete map[orderId];
    changed = true;
  }

  if (changed) {
    writeCheckoutTransitionMap(map);
  }

  return shouldPlay;
}

export function buildConfirmationPath(orderId: string, token?: string | null): string {
  const params = new URLSearchParams({ orderId });
  if (token) {
    params.set('token', token);
  }

  return `/confirmation?${params.toString()}`;
}
