/*
Handoff note for Mr. Smith:
- File: `src/hooks/useCashierDefaultPerformance.ts`
- What this is: Custom React hook.
- What it does: Encapsulates reusable state/effect behavior for web UI.
- Connections: Consumed by pages/components to avoid duplicated effect logic.
- Main content type: Stateful behavior and side-effect control.
- Safe edits here: Readability comments and conservative non-breaking tweaks.
- Be careful with: Effect timing/subscriptions that can create subtle UI regressions.
- Useful context: If multiple screens show the same behavior bug, inspect this hook.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
