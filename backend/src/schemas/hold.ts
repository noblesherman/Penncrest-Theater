import { z } from 'zod';

export const holdRequestSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).max(50),
  clientToken: z.string().min(8)
});
