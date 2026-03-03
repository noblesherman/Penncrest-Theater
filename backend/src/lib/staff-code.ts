import crypto from 'node:crypto';
import { env } from './env.js';

const STAFF_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeRedeemCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRedeemCode(code: string): string {
  const normalized = normalizeRedeemCode(code);
  return crypto.createHash('sha256').update(`${normalized}:${env.JWT_SECRET}`).digest('hex');
}

export function generateRedeemCode(length = 12): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    const idx = crypto.randomInt(0, STAFF_CODE_ALPHABET.length);
    value += STAFF_CODE_ALPHABET[idx];
  }

  // Add separators for easier in-person reads/scans.
  return value.match(/.{1,4}/g)?.join('-') || value;
}
