/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/secret-box.ts`
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

const ENCRYPTION_PREFIX = 'v1';
const KEY = crypto.createHash('sha256').update(env.JWT_SECRET).digest();

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_PREFIX, iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptSecret(payload: string): string {
  const [prefix, ivHex, tagHex, encryptedHex] = payload.split(':');
  if (prefix !== ENCRYPTION_PREFIX || !ivHex || !tagHex || !encryptedHex) {
    throw new Error('Invalid encrypted payload');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
