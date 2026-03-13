const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
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
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const messages = collectErrorMessages(record.error ?? record.message ?? record);
    const unique = [...new Set(messages)];
    if (unique.length > 0) {
      return unique.join(' ');
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }

  return `Request failed (${status})`;
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
