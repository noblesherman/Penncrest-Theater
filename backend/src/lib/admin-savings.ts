export const OTS_BASE_TRANSACTION_FEE_CENTS = 385;
export const OTS_EXTRA_TRANSACTION_FEE_CENTS = 30;
export const OTS_LOW_PROCESSING_RATE = 0.029;
export const OTS_MID_PROCESSING_RATE = 0.032;
export const OTS_HIGH_PROCESSING_RATE = 0.035;

type SavingsInputs = {
  allTimeRevenueCents: number;
  paidTransactionCount: number;
};

export function clampWholeNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function estimateSavingsCentsAtRate(
  allTimeRevenueCents: number,
  paidTransactionCount: number,
  processingRate: number
): number {
  return (
    OTS_BASE_TRANSACTION_FEE_CENTS * paidTransactionCount +
    Math.round(allTimeRevenueCents * processingRate) +
    OTS_EXTRA_TRANSACTION_FEE_CENTS * paidTransactionCount
  );
}

export function buildSavingsEstimate(inputs: SavingsInputs): {
  allTimeRevenueCents: number;
  paidTransactionCount: number;
  estimatedSavedCents: number;
  lowEstimateCents: number;
  highEstimateCents: number;
} {
  const allTimeRevenueCents = clampWholeNonNegative(inputs.allTimeRevenueCents);
  const paidTransactionCount = clampWholeNonNegative(inputs.paidTransactionCount);

  return {
    allTimeRevenueCents,
    paidTransactionCount,
    estimatedSavedCents: estimateSavingsCentsAtRate(allTimeRevenueCents, paidTransactionCount, OTS_MID_PROCESSING_RATE),
    lowEstimateCents: estimateSavingsCentsAtRate(allTimeRevenueCents, paidTransactionCount, OTS_LOW_PROCESSING_RATE),
    highEstimateCents: estimateSavingsCentsAtRate(allTimeRevenueCents, paidTransactionCount, OTS_HIGH_PROCESSING_RATE)
  };
}
