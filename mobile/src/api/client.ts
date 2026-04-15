import { API_BASE_URL } from '../config';
import { toTheaterFriendlyErrorMessage } from '../lib/theaterErrorTone';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
  statusCode?: number;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', token, body } = options;
  const hasBody = body !== undefined;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(hasBody ? { 'Content-Type': 'application/json' } : {})
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, toTheaterFriendlyErrorMessage('Request timed out. Check your connection and try again.'));
    }
    throw new ApiError(0, toTheaterFriendlyErrorMessage('Network request failed. Check your connection and try again.'));
  } finally {
    clearTimeout(timeout);
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? ((await response.json().catch(() => null)) as T | ApiErrorPayload | null) : null;

  if (!response.ok) {
    const fallback = toTheaterFriendlyErrorMessage(`That request missed its cue (${response.status})`);
    const message = (() => {
      if (!payload || typeof payload !== 'object') {
        return fallback;
      }
      if ('message' in payload && typeof payload.message === 'string' && payload.message.trim()) {
        return toTheaterFriendlyErrorMessage(payload.message, fallback);
      }
      if ('error' in payload && typeof payload.error === 'string' && payload.error.trim()) {
        return toTheaterFriendlyErrorMessage(payload.error, fallback);
      }
      return fallback;
    })();

    throw new ApiError(response.status, message);
  }

  return payload as T;
}
