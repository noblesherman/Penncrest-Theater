import { adminFetch } from './adminAuth';
import { apiUrl } from './api';
import type {
  PaymentLineEntry,
  PaymentLineEntryUpdatedEvent,
  PaymentLineReadyEvent,
  PaymentLineSnapshot
} from './paymentLineTypes';

export async function fetchAdminPaymentLineSnapshot(queueKey: string): Promise<PaymentLineSnapshot> {
  return adminFetch<PaymentLineSnapshot>(`/api/admin/payment-line/snapshot?queueKey=${encodeURIComponent(queueKey)}`);
}

export async function issueAdminPaymentLineEventsToken(queueKey: string): Promise<string> {
  const payload = await adminFetch<{ token: string }>(
    `/api/admin/payment-line/events/token?queueKey=${encodeURIComponent(queueKey)}`
  );
  return payload.token;
}

export function buildAdminPaymentLineEventsUrl(token: string): string {
  return apiUrl(`/api/admin/payment-line/events?token=${encodeURIComponent(token)}`);
}

export function findEntry(snapshot: PaymentLineSnapshot | null, entryId: string | null | undefined): PaymentLineEntry | null {
  if (!snapshot || !entryId) return null;
  return snapshot.entries.find((entry) => entry.entryId === entryId) || null;
}

export function findActiveEntry(snapshot: PaymentLineSnapshot | null): PaymentLineEntry | null {
  if (!snapshot) return null;
  if (snapshot.nowServingEntryId) {
    const entry = snapshot.entries.find((item) => item.entryId === snapshot.nowServingEntryId);
    if (entry) return entry;
  }
  return snapshot.entries.find((entry) => entry.uiState === 'ACTIVE_PAYMENT') || null;
}

export function applyEntryUpdatedToSnapshot(
  snapshot: PaymentLineSnapshot,
  update: PaymentLineEntryUpdatedEvent
): PaymentLineSnapshot {
  return {
    ...snapshot,
    nowServingEntryId: update.nowServingEntryId,
    waitingCount: update.waitingCount,
    updatedAt: update.updatedAt,
    entries: snapshot.entries.map((entry) =>
      entry.entryId !== update.entryId
        ? entry
        : {
            ...entry,
            position: update.position,
            waitingCount: update.waitingCount,
            nowServingEntryId: update.nowServingEntryId,
            isYourTurn: update.isYourTurn,
            isNext: update.isNext,
            uiState: update.uiState,
            updatedAt: update.updatedAt,
            status: update.status,
            failureReason: update.failureReason
          }
    )
  };
}

export function parseJsonEvent<T>(event: MessageEvent<string>): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

export type PaymentLineStreamReady = PaymentLineReadyEvent;
