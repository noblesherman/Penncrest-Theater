/*
Handoff note for Mr. Smith:
- File: `apps/api/src/config.ts`
- What this is: Secondary API support module.
- What it does: Provides config/errors/validation/bootstrap pieces for the Express app.
- Connections: Supports route/service execution inside `apps/api/src`.
- Main content type: Config/types/infrastructure logic.
- Safe edits here: Additive validation and documentation updates.
- Be careful with: Env parsing and shared type changes used broadly.
- Useful context: Helpful context when maintaining both API stacks in parallel.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
