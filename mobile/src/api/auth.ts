import { apiRequest } from './client';

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
    throw new Error('Account requires first-time 2FA setup in the web admin.');
  }

  if ('twoFactorRequired' in payload && payload.twoFactorRequired) {
    throw new Error('Authentication code required. Enter your 6-digit code and try again.');
  }

  if ('error' in payload && payload.error) {
    throw new Error(payload.error);
  }

  throw new Error('Unable to log in');
}
