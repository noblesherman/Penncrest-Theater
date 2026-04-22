/*
Handoff note for Mr. Smith:
- File: `src/lib/clientToken.ts`
- What this is: Frontend shared helper module.
- What it does: Holds reusable client logic, types, and config used across the web app.
- Connections: Imported by pages/components and often mirrors backend contracts.
- Main content type: Logic/config/data-shaping (not page layout).
- Safe edits here: Additive helpers and text constants.
- Be careful with: Changing exported behavior/types that many files consume.
- Useful context: If a bug appears across multiple pages, this shared layer is a likely source.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
