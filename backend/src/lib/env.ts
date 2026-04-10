import { z } from 'zod';

const isProductionEnv = process.env.NODE_ENV === 'production';

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((raw) => {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return raw;

    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(value)) return false;
    return raw;
  }, z.boolean()).default(defaultValue);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(isProductionEnv ? 1 : 0),
  ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER: booleanFromEnv(!isProductionEnv),
  ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER: booleanFromEnv(!isProductionEnv),
  ENABLE_IN_PROCESS_HEALTH_ALERT_MONITOR: booleanFromEnv(isProductionEnv),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  CORS_ALLOW_DEV_TUNNEL_ORIGINS: booleanFromEnv(false),

  STRIPE_SECRET_KEY: z.string().min(1).transform((value) => value.trim()),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).transform((value) => value.trim()),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).transform((value) => value.trim()).optional(),

  JWT_SECRET: z.string().min(16),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  STAFF_ALLOWED_DOMAIN: z.string().min(1).default('rtmsd.org'),

  HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  HOLD_ROUTE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(5000).default(180),
  CHECKOUT_ATTEMPT_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(20),
  CHECKOUT_ROUTE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(5000).default(120),
  CHECKOUT_QUEUE_STATUS_ROUTE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(20000).default(3000),
  CHECKOUT_MAX_ACTIVE: z.coerce.number().int().min(1).max(200).default(40),
  CHECKOUT_QUEUE_MAX_WAIT_SECONDS: z.coerce.number().int().min(30).max(60 * 30).default(480),
  CHECKOUT_QUEUE_POLL_MIN_MS: z.coerce.number().int().min(250).max(10_000).default(1500),
  CHECKOUT_QUEUE_POLL_MAX_MS: z.coerce.number().int().min(250).max(15_000).default(4000),
  PERFORMANCE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
  HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(30).default(10),
  TERMINAL_DISPATCH_HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(5),
  TERMINAL_DISPATCH_ALLOW_MOCK_PAYMENTS: booleanFromEnv(false),
  HOLD_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  HEALTH_ALERT_EMAIL_TO: z.string().default('noblesherman7@gmail.com'),
  HEALTH_ALERT_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30),
  HEALTH_ALERT_OVERLOADED_PROBE_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(90),
  HEALTH_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(24 * 7).default(15),
  HEALTH_ALERT_CPU_PERCENT_THRESHOLD: z.coerce.number().int().min(1).max(100).default(85),
  HEALTH_ALERT_MEMORY_MB_THRESHOLD: z.coerce.number().int().min(128).max(262144).default(1500),
  HEALTH_ALERT_QUEUE_WAITING_THRESHOLD: z.coerce.number().int().min(1).max(100000).default(120),
  HEALTH_ALERT_QUEUE_LAG_SECONDS_THRESHOLD: z.coerce.number().int().min(1).max(3600).default(20),
  HEALTH_ALERT_ERRORS_LAST_MINUTE_THRESHOLD: z.coerce.number().int().min(1).max(10000).default(6),
  HEALTH_ALERT_DATABASE_LATENCY_MS_THRESHOLD: z.coerce.number().int().min(10).max(60000).default(1200),
  HEALTH_ALERT_CHECKOUT_STALE_SECONDS_THRESHOLD: z.coerce.number().int().min(30).max(86400).default(300),
  HEALTH_ALERT_SEND_RECOVERY_EMAIL: booleanFromEnv(true),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),

  STAFF_CLAIM_CODE: z.string().optional(),
  STAFF_REDEEM_CODE_TTL_MINUTES: z.coerce.number().int().min(5).max(60 * 24 * 30).default(60 * 24 * 7),
  TRIP_LOGIN_CODE_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(15),
  TRIP_LOGIN_CODE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  TRIP_ACCOUNT_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(24),

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
