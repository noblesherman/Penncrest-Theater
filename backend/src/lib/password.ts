import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

const PASSWORD_HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${PASSWORD_HASH_PREFIX}:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [prefix, salt, hashHex] = storedHash.split(':');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}
