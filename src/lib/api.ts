import { toTheaterFriendlyErrorMessage } from './theaterErrorTone';

function normalizeApiBaseUrl(url?: string): string {
  const trimmed = url?.trim();
  if (!trimmed) {
    return 'https://api.penncresttheater.com';
  }

  try {
    const normalized = new URL(trimmed);
    if (normalized.protocol === 'http:' || normalized.protocol === 'https:') {
      return normalized.toString().replace(/\/$/, '');
    }
  } catch {
  }

  const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed);
  const protocol = isLocalHost ? 'http://' : 'https://';

  try {
    return new URL(`${protocol}${trimmed}`).toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function collectErrorMessages(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectErrorMessages(item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const prioritized: unknown[] = [];
    if ('formErrors' in record) prioritized.push(record.formErrors);
    if ('fieldErrors' in record) prioritized.push(record.fieldErrors);
    if ('message' in record) prioritized.push(record.message);

    const fallbackValues = Object.entries(record)
      .filter(([key]) => key !== 'formErrors' && key !== 'fieldErrors' && key !== 'message')
      .map(([, nested]) => nested);

    return [...prioritized, ...fallbackValues].flatMap((item) => collectErrorMessages(item));
  }

  return [];
}

function extractApiErrorMessage(body: unknown, status: number): string {
  const fallback = toTheaterFriendlyErrorMessage(`That request missed its cue (${status})`);

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const messages = collectErrorMessages(record.error ?? record.message ?? record);
    const unique = [...new Set(messages)];
    if (unique.length > 0) {
      return toTheaterFriendlyErrorMessage(unique.join(' '), fallback);
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return toTheaterFriendlyErrorMessage(body.trim(), fallback);
  }

  return fallback;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const isFormDataBody = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers = new Headers(init?.headers);
  if (hasBody && !isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(body, response.status));
  }

  return body as T;
}
