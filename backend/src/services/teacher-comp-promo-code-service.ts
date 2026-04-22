/*
Handoff note for Mr. Smith:
- File: `backend/src/services/teacher-comp-promo-code-service.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { hashRedeemCode, normalizeRedeemCode } from '../lib/staff-code.js';

export type TeacherCompPromoCodeValidation = {
  normalizedCode: string;
};

export async function validateTeacherCompPromoCode(rawCode: string): Promise<TeacherCompPromoCodeValidation> {
  const normalizedCode = normalizeRedeemCode(rawCode);
  if (normalizedCode.length < 4) {
    throw new HttpError(400, 'Teacher promo code is required');
  }

  const codeHash = hashRedeemCode(normalizedCode);
  const now = new Date();
  const code = await prisma.teacherCompPromoCode.findFirst({
    where: {
      codeHash,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    select: {
      id: true
    }
  });

  if (!code) {
    throw new HttpError(400, 'Invalid or expired teacher promo code');
  }

  return { normalizedCode };
}
