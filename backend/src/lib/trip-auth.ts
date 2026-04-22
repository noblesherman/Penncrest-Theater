/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/trip-auth.ts`
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
