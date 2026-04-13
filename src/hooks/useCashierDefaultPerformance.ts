const CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY = 'theater_cashier_default_performance_v1';

export function readCashierDefaultPerformanceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeCashierDefaultPerformanceId(performanceId: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!performanceId) {
      window.localStorage.removeItem(CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY, performanceId);
  } catch {
    // Ignore storage failures; cashier flow still works with in-memory state.
  }
}
