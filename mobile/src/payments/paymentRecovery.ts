/*
Handoff note for Mr. Smith:
- File: `mobile/src/payments/paymentRecovery.ts`
- What this is: Mobile payment/terminal integration module.
- What it does: Coordinates Tap to Pay / payment-sheet / terminal-specific operations.
- Connections: Connected to sell-ticket screens and backend payment endpoints.
- Main content type: Payment lifecycle logic and provider integration.
- Safe edits here: Status wording and non-breaking diagnostics.
- Be careful with: Retry/state-machine assumptions in money-moving flows.
- Useful context: If payment behavior drifts, trace ordering here before changing UI.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatePaymentIntentResponse } from '../api/mobile';

const PENDING_SALE_KEY = 'theater.mobile.payment.pendingSale';
const ACTIVE_TERMINAL_DISPATCH_KEY = 'theater.mobile.terminal.activeDispatch';

export type TerminalDispatchRecoveryState = {
  dispatchId: string;
  deviceId: string;
  paymentIntentId: string;
  paymentMethod: 'tap' | 'manual' | 'unknown';
  stage: string;
  updatedAt: string;
};

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function savePendingSale(sale: CreatePaymentIntentResponse): Promise<void> {
  await AsyncStorage.setItem(PENDING_SALE_KEY, JSON.stringify(sale));
}

export async function loadPendingSale(): Promise<CreatePaymentIntentResponse | null> {
  return parseJson<CreatePaymentIntentResponse>(await AsyncStorage.getItem(PENDING_SALE_KEY));
}

export async function clearPendingSale(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_SALE_KEY);
}

export async function saveTerminalDispatchRecovery(state: TerminalDispatchRecoveryState): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_TERMINAL_DISPATCH_KEY, JSON.stringify(state));
}

export async function loadTerminalDispatchRecovery(): Promise<TerminalDispatchRecoveryState | null> {
  return parseJson<TerminalDispatchRecoveryState>(await AsyncStorage.getItem(ACTIVE_TERMINAL_DISPATCH_KEY));
}

export async function clearTerminalDispatchRecovery(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_TERMINAL_DISPATCH_KEY);
}
