import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  APP_URL: z.string().url(),
  ADMIN_APP_URL: z.string().url(),
  EMAIL_FROM: z.string().email(),
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional()
}).refine((env) => env.SENDGRID_API_KEY || env.RESEND_API_KEY, {
  message: 'Provide SENDGRID_API_KEY or RESEND_API_KEY'
});

export const env = EnvSchema.parse(process.env);
