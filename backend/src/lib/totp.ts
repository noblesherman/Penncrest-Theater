import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TIME_STEP_SECONDS = 30;
const CODE_DIGITS = 6;

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 secret');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateHotp(secret: string, counter: number): string {
  const secretBytes = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto.createHmac('sha1', secretBytes).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(code % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function formatTotpSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') || secret;
}

export function buildOtpAuthUrl(params: { issuer: string; accountName: string; secret: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(CODE_DIGITS),
    period: String(TIME_STEP_SECONDS)
  });

  return `otpauth://totp/${label}?${query.toString()}`;
}

export function normalizeOtpCode(code: string): string {
  return code.replace(/\D/g, '');
}

export function verifyTotpCode(params: {
  secret: string;
  code: string;
  now?: number;
  window?: number;
}): boolean {
  const normalizedCode = normalizeOtpCode(params.code);
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const now = params.now ?? Date.now();
  const step = Math.floor(now / 1000 / TIME_STEP_SECONDS);
  const window = params.window ?? 1;

  for (let offset = -window; offset <= window; offset += 1) {
    if (generateHotp(params.secret, step + offset) === normalizedCode) {
      return true;
    }
  }

  return false;
}
