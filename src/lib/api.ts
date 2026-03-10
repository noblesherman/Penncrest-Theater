const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
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
    const message = body?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}
