import { apiFetch } from './api';

const ADMIN_SESSION_TOKEN_KEY = 'theater_admin_token';
const ADMIN_PERSISTENT_TOKEN_KEY = 'theater_admin_token_persistent';

function readAdminTokenStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function readLegacyAdminTokenStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export type AdminRole = 'BOX_OFFICE' | 'ADMIN' | 'SUPER_ADMIN';

export type AdminSession = {
  id: string;
  username: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const roleRank: Record<AdminRole, number> = {
  BOX_OFFICE: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3
};

export function getAdminToken(): string | null {
  const sessionToken = readAdminTokenStorage()?.getItem(ADMIN_SESSION_TOKEN_KEY);
  if (sessionToken) return sessionToken;

  const localStorage = readLegacyAdminTokenStorage();
  const persistentToken = localStorage?.getItem(ADMIN_PERSISTENT_TOKEN_KEY) || null;
  if (persistentToken) return persistentToken;

  const legacyToken = localStorage?.getItem(ADMIN_SESSION_TOKEN_KEY) || null;
  if (legacyToken) {
    localStorage?.setItem(ADMIN_PERSISTENT_TOKEN_KEY, legacyToken);
    localStorage?.removeItem(ADMIN_SESSION_TOKEN_KEY);
  }

  return legacyToken;
}

export function setAdminToken(token: string, options?: { persistent?: boolean }): void {
  const sessionStorage = readAdminTokenStorage();
  const localStorage = readLegacyAdminTokenStorage();

  if (options?.persistent) {
    localStorage?.setItem(ADMIN_PERSISTENT_TOKEN_KEY, token);
    sessionStorage?.removeItem(ADMIN_SESSION_TOKEN_KEY);
    localStorage?.removeItem(ADMIN_SESSION_TOKEN_KEY);
    return;
  }

  sessionStorage?.setItem(ADMIN_SESSION_TOKEN_KEY, token);
  localStorage?.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
  localStorage?.removeItem(ADMIN_SESSION_TOKEN_KEY);
}

export function clearAdminToken(): void {
  readAdminTokenStorage()?.removeItem(ADMIN_SESSION_TOKEN_KEY);
  readLegacyAdminTokenStorage()?.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
  readLegacyAdminTokenStorage()?.removeItem(ADMIN_SESSION_TOKEN_KEY);
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}

export function hasAdminRole(currentRole: AdminRole, minimumRole: AdminRole): boolean {
  return roleRank[currentRole] >= roleRank[minimumRole];
}

export function formatAdminRole(role: AdminRole): string {
  switch (role) {
    case 'BOX_OFFICE':
      return 'Box Office';
    case 'ADMIN':
      return 'Admin';
    case 'SUPER_ADMIN':
      return 'Super Admin';
  }
}

export async function ensureAdminSession(): Promise<AdminSession> {
  return adminFetch<AdminSession>('/api/admin/me');
}
