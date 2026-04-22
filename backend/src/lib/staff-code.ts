/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/staff-code.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
