import crypto from 'node:crypto';
import { env } from './env.js';

export function normalizeTripAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeTripLoginCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

export function generateTripLoginCode(length = 6): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += crypto.randomInt(0, 10).toString();
  }
  return value;
}

export function hashTripLoginCode(code: string): string {
  const normalized = normalizeTripLoginCode(code);
  return crypto.createHash('sha256').update(`${normalized}:${env.JWT_SECRET}`).digest('hex');
}
