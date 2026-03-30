import crypto from 'node:crypto';

export function generateOrderAccessToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}
