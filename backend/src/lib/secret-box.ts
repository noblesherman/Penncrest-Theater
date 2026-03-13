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
