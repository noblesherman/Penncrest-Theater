import { z } from 'zod';
import { eventRegistrationSubmissionSchema } from '../lib/event-registration-form.js';

export const checkoutRequestSchema = z.object({
  performanceId: z.string().min(1),
  checkoutMode: z.enum(['PAID', 'TEACHER_COMP', 'STUDENT_COMP']).default('PAID'),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelections: z
    .array(
      z.object({
        tierId: z.string().min(1),
        count: z.number().int().min(0).max(50)
      })
    )
    .optional(),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)).optional(),
  holdToken: z.string().min(8),
  clientToken: z.string().min(8),
  teacherPromoCode: z.string().min(4).max(64).optional(),
  studentCode: z.string().min(1).max(120).optional(),
  studentSchoolEmail: z.string().min(1).max(120).optional(),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(7).max(40),
  attendeeNames: z.record(z.string().min(1), z.string().min(1).max(80)).optional(),
  registrationSubmission: eventRegistrationSubmissionSchema.optional(),
  clientIpAddress: z.string().max(120).optional()
});
