import { z } from 'zod';

export const checkoutRequestSchema = z.object({
  performanceId: z.string().min(1),
  checkoutMode: z.enum(['PAID', 'TEACHER_COMP', 'FAMILY_FREE']).default('PAID'),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelections: z
    .array(
      z.object({
        tierId: z.string().min(1),
        count: z.number().int().min(0).max(50)
      })
    )
    .optional(),
  holdToken: z.string().min(8),
  clientToken: z.string().min(8),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  attendeeNames: z.record(z.string().min(1), z.string().min(1).max(80)).optional()
});
