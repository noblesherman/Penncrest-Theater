/*
Handoff note for Mr. Smith:
- File: `mobile/src/api/auth.ts`
- What this is: Mobile API client module.
- What it does: Wraps HTTP requests and response handling for app workflows.
- Connections: Called by auth, screens, and device/payment flows.
- Main content type: Network/data mapping logic.
- Safe edits here: Additive helpers and non-breaking error-message improvements.
- Be careful with: Endpoint path or response-shape changes.
- Useful context: If multiple screens break after backend edits, compare contracts here first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { apiRequest } from './client';
import { toTheaterFriendlyErrorMessage } from '../lib/theaterErrorTone';

export type LoginResponse = {
  token: string;
  admin: {
    id: string;
    username: string;
    name: string;
    role: 'BOX_OFFICE' | 'ADMIN' | 'SUPER_ADMIN';
  };
};

export async function loginAdmin(params: {
  username: string;
  password: string;
  otpCode?: string;
}): Promise<LoginResponse> {
  const payload = await apiRequest<
    | LoginResponse
    | {
        twoFactorRequired?: boolean;
        twoFactorSetupRequired?: boolean;
        error?: string;
      }
  >('/api/admin/login', {
    method: 'POST',
    body: params
  });

  if ('token' in payload && payload.token) {
    return payload;
  }

  if ('twoFactorSetupRequired' in payload && payload.twoFactorSetupRequired) {
    throw new Error(toTheaterFriendlyErrorMessage('Account requires first-time 2FA setup in the web admin.'));
  }

  if ('twoFactorRequired' in payload && payload.twoFactorRequired) {
    throw new Error(toTheaterFriendlyErrorMessage('Authentication code required. Enter your 6-digit code and try again.'));
  }

  if ('error' in payload && payload.error) {
    throw new Error(toTheaterFriendlyErrorMessage(payload.error));
  }

  throw new Error(toTheaterFriendlyErrorMessage('We could not log in'));
}
