import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  JWT_SECRET: z.string().min(16),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  STAFF_ALLOWED_DOMAIN: z.string().min(1).default('rtmsd.org'),

  HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
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

  GOOGLE_CALENDAR_ICS_URL: z.string().url().optional()
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid backend environment variables');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

export function getAllowedOrigins(): string[] {
  return env.FRONTEND_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean);
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}
