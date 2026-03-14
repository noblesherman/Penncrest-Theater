import { apiFetch } from './api';

const STAFF_TOKEN_KEY = 'theater_staff_token';

function readStaffTokenStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function readLegacyStaffTokenStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function getStaffToken(): string | null {
  const token = readStaffTokenStorage()?.getItem(STAFF_TOKEN_KEY);
  if (token) return token;

  const legacyToken = readLegacyStaffTokenStorage()?.getItem(STAFF_TOKEN_KEY) || null;
  if (legacyToken) {
    readStaffTokenStorage()?.setItem(STAFF_TOKEN_KEY, legacyToken);
    readLegacyStaffTokenStorage()?.removeItem(STAFF_TOKEN_KEY);
  }

  return legacyToken;
}

export function setStaffToken(token: string): void {
  readStaffTokenStorage()?.setItem(STAFF_TOKEN_KEY, token);
  readLegacyStaffTokenStorage()?.removeItem(STAFF_TOKEN_KEY);
}

export function clearStaffToken(): void {
  readStaffTokenStorage()?.removeItem(STAFF_TOKEN_KEY);
  readLegacyStaffTokenStorage()?.removeItem(STAFF_TOKEN_KEY);
}

export function consumeStaffTokenFromUrlHash(): string | null {
  if (typeof window === 'undefined') return null;

  const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!rawHash) return null;

  const hashParams = new URLSearchParams(rawHash);
  const token = hashParams.get('authToken');
  if (!token) return null;

  hashParams.delete('authToken');
  const nextHash = hashParams.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState(window.history.state, '', nextUrl);

  return token;
}

export async function staffFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStaffToken();
  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}
