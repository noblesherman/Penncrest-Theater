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
