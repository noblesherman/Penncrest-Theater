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
