/*
Handoff note for Mr. Smith:
- File: `apps/api/src/services/pricing.ts`
- What this is: Express service handler module (secondary API app).
- What it does: Contains request business logic used by route handlers.
- Connections: Invoked from routes and tied to Prisma/Stripe helpers.
- Main content type: Business logic with DB/payment side effects.
- Safe edits here: Comments and non-breaking readability improvements.
- Be careful with: Idempotency and write-order changes in checkout/payment flows.
- Useful context: If this app is still live anywhere, keep behavior changes tightly controlled.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { PriceRuleType, Seat, Tier } from '@prisma/client';

export function computeSeatPrice(params: {
  tier: Tier;
  seat: Seat;
  priceRules: { type: PriceRuleType; configJson: any }[];
}): number {
  let price = params.tier.priceCents;

  for (const rule of params.priceRules) {
    if (rule.type === 'SEAT_PREMIUM_BY_ROW') {
      const rows: Record<string, number> = rule.configJson?.rows || {};
      if (rows[params.seat.rowLabel]) price += rows[params.seat.rowLabel];
    }
    if (rule.type === 'SEAT_PREMIUM_BY_FLAG') {
      const flags: Record<string, number> = rule.configJson?.flags || {};
      const seatFlags = (params.seat.flagsJson as Record<string, boolean>) || {};
      for (const [flag, premium] of Object.entries(flags)) {
        if (seatFlags[flag]) price += Number(premium);
      }
    }
  }

  return price;
}
