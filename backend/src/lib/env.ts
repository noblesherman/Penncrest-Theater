import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  CORS_ALLOW_DEV_TUNNEL_ORIGINS: z.coerce.boolean().default(false),

  STRIPE_SECRET_KEY: z.string().min(1).transform((value) => value.trim()),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).transform((value) => value.trim()),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).transform((value) => value.trim()).optional(),

  JWT_SECRET: z.string().min(16),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  STAFF_ALLOWED_DOMAIN: z.string().min(1).default('rtmsd.org'),

  HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  CHECKOUT_ATTEMPT_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(20),
  PERFORMANCE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
  TERMINAL_DISPATCH_HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(5),
  TERMINAL_DISPATCH_ALLOW_MOCK_PAYMENTS: z.coerce.boolean().default(false),
  HOLD_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),

  STAFF_CLAIM_CODE: z.string().optional(),
  STAFF_REDEEM_CODE_TTL_MINUTES: z.coerce.number().int().min(5).max(60 * 24 * 30).default(60 * 24 * 7),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_OAUTH_TENANT: z.string().default('common'),

  GOOGLE_CALENDAR_ICS_URL: z.string().url().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  R2_UPLOAD_PREFIX: z.string().default('uploads'),
  R2_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).max(50 * 1024 * 1024).default(8 * 1024 * 1024)
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid backend environment variables');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

export function getAllowedOrigins(): string[] {
  return [...new Set([env.APP_BASE_URL, 'http://localhost:5173', 'http://localhost:3000', ...env.FRONTEND_ORIGIN.split(',')])]
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  uploadPrefix: string;
  maxUploadBytes: number;
};

export function getR2Config(): R2Config | null {
  const endpoint = env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  if (!endpoint || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PUBLIC_BASE_URL) {
    return null;
  }

  return {
    endpoint,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL.replace(/\/+$/, ''),
    uploadPrefix: env.R2_UPLOAD_PREFIX.replace(/^\/+|\/+$/g, ''),
    maxUploadBytes: env.R2_MAX_UPLOAD_BYTES
  };
}
