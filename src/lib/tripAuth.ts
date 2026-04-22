/*
Handoff note for Mr. Smith:
- File: `src/lib/tripAuth.ts`
- What this is: Frontend shared helper module.
- What it does: Holds reusable client logic, types, and config used across the web app.
- Connections: Imported by pages/components and often mirrors backend contracts.
- Main content type: Logic/config/data-shaping (not page layout).
- Safe edits here: Additive helpers and text constants.
- Be careful with: Changing exported behavior/types that many files consume.
- Useful context: If a bug appears across multiple pages, this shared layer is a likely source.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { apiFetch } from './api';

const TRIP_TOKEN_KEY = 'theater_trip_account_token';

function readStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function readLegacyStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function getTripToken(): string | null {
  const token = readStorage()?.getItem(TRIP_TOKEN_KEY);
  if (token) return token;

  const legacyToken = readLegacyStorage()?.getItem(TRIP_TOKEN_KEY) || null;
  if (legacyToken) {
    readStorage()?.setItem(TRIP_TOKEN_KEY, legacyToken);
    readLegacyStorage()?.removeItem(TRIP_TOKEN_KEY);
  }

  return legacyToken;
}

export function setTripToken(token: string): void {
  readStorage()?.setItem(TRIP_TOKEN_KEY, token);
  readLegacyStorage()?.removeItem(TRIP_TOKEN_KEY);
}

export function clearTripToken(): void {
  readStorage()?.removeItem(TRIP_TOKEN_KEY);
  readLegacyStorage()?.removeItem(TRIP_TOKEN_KEY);
}

export async function tripFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getTripToken();
  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}
