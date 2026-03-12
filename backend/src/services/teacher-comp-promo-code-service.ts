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
