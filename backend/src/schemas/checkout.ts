/*
Handoff note for Mr. Smith:
- File: `backend/src/schemas/checkout.ts`
- What this is: Backend validation schema module.
- What it does: Defines typed input constraints for route payloads.
- Connections: Referenced by route handlers and service input guards.
- Main content type: Schema/type declarations.
- Safe edits here: Additive optional fields and docs comments.
- Be careful with: Required-field or shape changes that break clients.
- Useful context: Contract edits here should be coordinated with frontend/mobile callers.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
  donationAmountCents: z.number().int().min(0).max(100000).optional(),
  clientIpAddress: z.string().max(120).optional()
});
