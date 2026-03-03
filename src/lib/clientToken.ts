const CLIENT_TOKEN_STORAGE_KEY = 'theater_client_token';

export function getClientToken(): string {
  let token = sessionStorage.getItem(CLIENT_TOKEN_STORAGE_KEY);
  if (token) {
    return token;
  }

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    token = crypto.randomUUID();
  } else {
    token = `client_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }

  sessionStorage.setItem(CLIENT_TOKEN_STORAGE_KEY, token);
  return token;
}
