import { describe, expect, it } from 'vitest';
import { buildSavingsEstimate } from '../lib/admin-savings.js';

describe('admin savings estimate math', () => {
  it('uses the required midpoint formula', () => {
    const summary = buildSavingsEstimate({
      allTimeRevenueCents: 5_000_000,
      paidTransactionCount: 125
    });

    expect(summary.estimatedSavedCents).toBe(
      385 * 125 + Math.round(5_000_000 * 0.032) + 30 * 125
    );
    expect(summary.lowEstimateCents).toBe(
      385 * 125 + Math.round(5_000_000 * 0.029) + 30 * 125
    );
    expect(summary.highEstimateCents).toBe(
      385 * 125 + Math.round(5_000_000 * 0.035) + 30 * 125
    );
  });

  it('clamps invalid or negative inputs safely', () => {
    const summary = buildSavingsEstimate({
      allTimeRevenueCents: -25_000,
      paidTransactionCount: -4
    });

    expect(summary.allTimeRevenueCents).toBe(0);
    expect(summary.paidTransactionCount).toBe(0);
    expect(summary.estimatedSavedCents).toBe(0);
    expect(summary.lowEstimateCents).toBe(0);
    expect(summary.highEstimateCents).toBe(0);
  });
});
