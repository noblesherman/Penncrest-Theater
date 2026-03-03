import { apiFetch } from './api';

const STAFF_TOKEN_KEY = 'theater_staff_token';

export function getStaffToken(): string | null {
  return localStorage.getItem(STAFF_TOKEN_KEY);
}

export function setStaffToken(token: string): void {
  localStorage.setItem(STAFF_TOKEN_KEY, token);
}

export function clearStaffToken(): void {
  localStorage.removeItem(STAFF_TOKEN_KEY);
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
