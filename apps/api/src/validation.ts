/*
Handoff note for Mr. Smith:
- File: `apps/api/src/validation.ts`
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

export const holdRequestSchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1),
  tierId: z.string().min(1),
  clientSessionToken: z.string().min(8),
  extend: z.boolean().optional()
});

export const releaseRequestSchema = z.object({
  clientSessionToken: z.string().min(8)
});

export const checkoutRequestSchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1),
  tierId: z.string().min(1),
  clientSessionToken: z.string().min(8),
  buyerEmail: z.string().email(),
  buyerName: z.string().optional(),
  promoCode: z.string().optional()
});
