const GREETING_STORAGE_KEY = 'theater_admin_post_login_greeting';
const GREETING_MAX_AGE_MS = 5 * 60 * 1000;
export const ADMIN_GREETING_DURATION_MS = 4_000;

type GreetingPayload = {
  message: string;
  createdAt: number;
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildAdminPostLoginGreeting(name: string): string | null {
  const clean = normalize(name);
  const lowered = clean.toLowerCase();

  // Friendly in-jokes for staff.
  if (lowered === 'jennifer smith') return 'Hi Mrs. Smith';
  if (lowered === 'jen smith') return 'Hi Mrs. Smith';
  if (lowered === 'scott smith') return 'Hi Mr. Smith';
  if (lowered === 'noble sherman') return 'Hi Mr. Sherman';

  return null;
}

export function queueAdminPostLoginGreeting(name: string): void {
  if (typeof window === 'undefined') return;
  const message = buildAdminPostLoginGreeting(name);
  if (!message) return;
  const payload: GreetingPayload = { message, createdAt: Date.now() };
  window.sessionStorage.setItem(GREETING_STORAGE_KEY, JSON.stringify(payload));
}

export function consumeAdminPostLoginGreeting(): string | null {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(GREETING_STORAGE_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(GREETING_STORAGE_KEY);

  try {
    const parsed = JSON.parse(raw) as GreetingPayload;
    if (!parsed?.message || typeof parsed.message !== 'string') return null;
    if (typeof parsed.createdAt !== 'number') return null;
    if (Date.now() - parsed.createdAt > GREETING_MAX_AGE_MS) return null;
    return parsed.message;
  } catch {
    return null;
  }
}
