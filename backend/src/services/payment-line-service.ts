/*
Handoff note for Mr. Smith:
- File: `backend/src/services/payment-line-service.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { Prisma, TerminalDispatchStatus } from '@prisma/client';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { releaseHoldByToken } from './hold-service.js';
import { parseTerminalDispatchSnapshot } from './terminal-dispatch-service.js';
import { broadcastPaymentLineEvent } from './payment-line-events.js';

export const PAYMENT_LINE_WAITING_STATUSES: TerminalDispatchStatus[] = ['PENDING', 'DELIVERED'];
export const PAYMENT_LINE_OPEN_STATUSES: TerminalDispatchStatus[] = ['PENDING', 'DELIVERED', 'PROCESSING'];
export const PAYMENT_LINE_FINAL_STATUSES: TerminalDispatchStatus[] = ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELED'];

const PAYMENT_LINE_ACTIVE_TIMEOUT_MS = env.PAYMENT_LINE_ACTIVE_TIMEOUT_SECONDS * 1_000;

export type PaymentLineUiState =
  | 'WAITING_FOR_PAYMENT'
  | 'ACTIVE_PAYMENT'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'CANCELED';

const paymentLineDispatchSelect = Prisma.validator<Prisma.TerminalPaymentDispatchSelect>()({
  id: true,
  status: true,
  queueKey: true,
  queueSortAt: true,
  performanceId: true,
  targetDeviceId: true,
  targetDeviceSessionId: true,
  holdToken: true,
  holdExpiresAt: true,
  expectedAmountCents: true,
  currency: true,
  stripePaymentIntentId: true,
  stripePaymentIntentClientSecret: true,
  saleSnapshot: true,
  attemptCount: true,
  failureReason: true,
  sellerStationName: true,
  sellerAdminId: true,
  sellerClientSessionId: true,
  deliveredAt: true,
  processingStartedAt: true,
  processingHeartbeatAt: true,
  activeTimeoutAt: true,
  completedAt: true,
  canceledAt: true,
  finalOrderId: true,
  createdByAdminId: true,
  createdAt: true,
  updatedAt: true,
  targetDeviceSession: {
    select: {
      displayName: true
    }
  }
});

type PaymentLineDispatchRecord = Prisma.TerminalPaymentDispatchGetPayload<{ select: typeof paymentLineDispatchSelect }>;

type QueueComputation = {
  nowServing: PaymentLineDispatchRecord | null;
  waitingEntries: PaymentLineDispatchRecord[];
  orderedEntries: PaymentLineDispatchRecord[];
  nextUp: PaymentLineDispatchRecord | null;
};

function compareByQueueSort(a: PaymentLineDispatchRecord, b: PaymentLineDispatchRecord): number {
  const sortDiff = a.queueSortAt.getTime() - b.queueSortAt.getTime();
  if (sortDiff !== 0) {
    return sortDiff;
  }

  const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return a.id.localeCompare(b.id);
}

function compareActiveByStart(a: PaymentLineDispatchRecord, b: PaymentLineDispatchRecord): number {
  const aTime = a.processingStartedAt?.getTime() ?? a.queueSortAt.getTime();
  const bTime = b.processingStartedAt?.getTime() ?? b.queueSortAt.getTime();
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return compareByQueueSort(a, b);
}

function computeQueue(entries: PaymentLineDispatchRecord[]): QueueComputation {
  const activeEntries = entries.filter((entry) => entry.status === 'PROCESSING').sort(compareActiveByStart);
  const waitingEntries = entries
    .filter((entry) => PAYMENT_LINE_WAITING_STATUSES.includes(entry.status))
    .sort(compareByQueueSort);

  const nowServing = activeEntries[0] || null;
  const orderedEntries = nowServing ? [nowServing, ...waitingEntries] : [...waitingEntries];
  const nextUp = nowServing ? waitingEntries[0] || null : waitingEntries[1] || null;

  return {
    nowServing,
    waitingEntries,
    orderedEntries,
    nextUp
  };
}

function mapStatusToUiState(status: TerminalDispatchStatus): PaymentLineUiState {
  if (status === 'PROCESSING') return 'ACTIVE_PAYMENT';
  if (status === 'SUCCEEDED') return 'PAYMENT_SUCCESS';
  if (status === 'FAILED' || status === 'EXPIRED') return 'PAYMENT_FAILED';
  if (status === 'CANCELED') return 'CANCELED';
  return 'WAITING_FOR_PAYMENT';
}

function findPosition(entry: PaymentLineDispatchRecord, orderedEntries: PaymentLineDispatchRecord[]): number | null {
  if (!PAYMENT_LINE_OPEN_STATUSES.includes(entry.status)) {
    return null;
  }

  const index = orderedEntries.findIndex((candidate) => candidate.id === entry.id);
  return index >= 0 ? index + 1 : null;
}

export type PaymentLineEntryView = {
  entryId: string;
  dispatchId: string;
  queueKey: string;
  performanceId: string;
  performanceTitle: string;
  queueSortAt: string;
  status: TerminalDispatchStatus;
  failureReason: string | null;
  holdExpiresAt: string;
  holdActive: boolean;
  canRetry: boolean;
  expectedAmountCents: number;
  currency: string;
  paymentIntentId: string | null;
  paymentIntentClientSecret: string | null;
  attemptCount: number;
  finalOrderId: string | null;
  targetDeviceId: string;
  targetDeviceName: string | null;
  sellerStationName: string | null;
  sellerAdminId: string | null;
  sellerClientSessionId: string | null;
  seatCount: number;
  seats: Array<{
    id: string;
    sectionName: string;
    row: string;
    number: number;
    ticketType: string;
    priceCents: number;
    label: string;
  }>;
  position: number | null;
  waitingCount: number;
  nowServingEntryId: string | null;
  processingStartedAt: string | null;
  processingHeartbeatAt: string | null;
  activeTimeoutAt: string | null;
  isYourTurn: boolean;
  isNext: boolean;
  uiState: PaymentLineUiState;
  updatedAt: string;
};

export type PaymentLineSnapshot = {
  queueKey: string;
  nowServingEntryId: string | null;
  nextUpEntryId: string | null;
  waitingCount: number;
  updatedAt: string;
  entries: PaymentLineEntryView[];
};

function toPaymentLineEntryView(params: {
  entry: PaymentLineDispatchRecord;
  queue: QueueComputation;
}): PaymentLineEntryView {
  const snapshot = parseTerminalDispatchSnapshot(params.entry.saleSnapshot);
  const now = Date.now();
  const position = findPosition(params.entry, params.queue.orderedEntries);
  const isYourTurn = params.entry.status === 'PROCESSING' || (!params.queue.nowServing && position === 1);
  const isNext = params.queue.nextUp?.id === params.entry.id;
  const holdActive = params.entry.holdExpiresAt.getTime() > now;

  return {
    entryId: params.entry.id,
    dispatchId: params.entry.id,
    queueKey: params.entry.queueKey,
    performanceId: params.entry.performanceId,
    performanceTitle: snapshot.performanceTitle,
    queueSortAt: params.entry.queueSortAt.toISOString(),
    status: params.entry.status,
    failureReason: params.entry.failureReason,
    holdExpiresAt: params.entry.holdExpiresAt.toISOString(),
    holdActive,
    canRetry: params.entry.status === 'FAILED' && holdActive,
    expectedAmountCents: params.entry.expectedAmountCents,
    currency: params.entry.currency,
    paymentIntentId: params.entry.stripePaymentIntentId,
    paymentIntentClientSecret: params.entry.stripePaymentIntentClientSecret,
    attemptCount: params.entry.attemptCount,
    finalOrderId: params.entry.finalOrderId,
    targetDeviceId: params.entry.targetDeviceId,
    targetDeviceName: params.entry.targetDeviceSession?.displayName || null,
    sellerStationName: params.entry.sellerStationName,
    sellerAdminId: params.entry.sellerAdminId,
    sellerClientSessionId: params.entry.sellerClientSessionId,
    seatCount: snapshot.seatIds.length,
    seats: snapshot.seatIds.map((seatId) => {
      const seatSummary = snapshot.seatSummaryBySeatId[seatId];
      return {
        id: seatId,
        sectionName: seatSummary?.sectionName || 'General Admission',
        row: seatSummary?.row || 'GA',
        number: seatSummary?.number ?? 0,
        ticketType: snapshot.ticketTypeBySeatId[seatId] || 'Ticket',
        priceCents: snapshot.priceBySeatId[seatId] ?? 0,
        label: seatSummary?.label || snapshot.seatLabelsBySeatId[seatId] || seatId
      };
    }),
    position,
    waitingCount: params.queue.waitingEntries.length,
    nowServingEntryId: params.queue.nowServing?.id || null,
    processingStartedAt: params.entry.processingStartedAt?.toISOString() || null,
    processingHeartbeatAt: params.entry.processingHeartbeatAt?.toISOString() || null,
    activeTimeoutAt: params.entry.activeTimeoutAt?.toISOString() || null,
    isYourTurn,
    isNext,
    uiState: mapStatusToUiState(params.entry.status),
    updatedAt: params.entry.updatedAt.toISOString()
  };
}

export async function fetchPaymentLineQueueEntries(queueKey: string): Promise<PaymentLineDispatchRecord[]> {
  return prisma.terminalPaymentDispatch.findMany({
    where: {
      queueKey,
      status: { in: PAYMENT_LINE_OPEN_STATUSES }
    },
    select: paymentLineDispatchSelect
  });
}

export async function fetchPaymentLineSnapshot(queueKey: string): Promise<PaymentLineSnapshot> {
  const entries = await fetchPaymentLineQueueEntries(queueKey);
  const queue = computeQueue(entries);
  const updatedAtMs = entries.reduce((maxValue, entry) => Math.max(maxValue, entry.updatedAt.getTime()), Date.now());

  return {
    queueKey,
    nowServingEntryId: queue.nowServing?.id || null,
    nextUpEntryId: queue.nextUp?.id || null,
    waitingCount: queue.waitingEntries.length,
    updatedAt: new Date(updatedAtMs).toISOString(),
    entries: queue.orderedEntries.map((entry) => toPaymentLineEntryView({ entry, queue }))
  };
}

export async function fetchPaymentLineEntry(entryId: string): Promise<PaymentLineEntryView> {
  const entry = await prisma.terminalPaymentDispatch.findUnique({
    where: { id: entryId },
    select: paymentLineDispatchSelect
  });

  if (!entry) {
    throw new HttpError(404, 'Payment line entry not found');
  }

  const queueEntries = await fetchPaymentLineQueueEntries(entry.queueKey);
  const queue = computeQueue(queueEntries);
  return toPaymentLineEntryView({ entry, queue });
}

async function withQueueAdvisoryLock<T>(params: {
  tx: Prisma.TransactionClient;
  queueKey: string;
  action: () => Promise<T>;
}): Promise<T> {
  await params.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`payment-line:${params.queueKey}`}))
  `;

  return params.action();
}

export async function startPaymentLineEntry(params: {
  entryId: string;
  deviceId: string;
}): Promise<PaymentLineEntryView> {
  const now = new Date();
  const activeTimeoutAt = new Date(now.getTime() + PAYMENT_LINE_ACTIVE_TIMEOUT_MS);

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.terminalPaymentDispatch.findUnique({
      where: { id: params.entryId },
      select: {
        id: true,
        status: true,
        queueKey: true,
        targetDeviceId: true,
        processingStartedAt: true,
        deliveredAt: true
      }
    });

    if (!current) {
      throw new HttpError(404, 'Payment line entry not found');
    }
    if (current.targetDeviceId !== params.deviceId || current.queueKey !== params.deviceId) {
      throw new HttpError(403, 'Entry is assigned to a different payment device');
    }
    if (['SUCCEEDED', 'EXPIRED', 'CANCELED'].includes(current.status)) {
      throw new HttpError(409, `Entry is ${current.status} and cannot be started`);
    }

    return withQueueAdvisoryLock({
      tx,
      queueKey: current.queueKey,
      action: async () => {
        const activeSibling = await tx.terminalPaymentDispatch.findFirst({
          where: {
            queueKey: current.queueKey,
            status: 'PROCESSING',
            id: { not: current.id }
          },
          select: { id: true }
        });

        if (activeSibling) {
          throw new HttpError(409, 'Another payment is already active in this queue');
        }

        return tx.terminalPaymentDispatch.update({
          where: { id: current.id },
          data: {
            status: 'PROCESSING',
            deliveredAt: current.deliveredAt || now,
            processingStartedAt: current.processingStartedAt || now,
            processingHeartbeatAt: now,
            activeTimeoutAt,
            failureReason: null
          },
          select: paymentLineDispatchSelect
        });
      }
    });
  });

  await publishQueueAndEntry(updated.queueKey, updated.id);
  return fetchPaymentLineEntry(updated.id);
}

export async function heartbeatPaymentLineEntry(params: {
  entryId: string;
  deviceId: string;
}): Promise<{ ok: true; activeTimeoutAt: string }> {
  const now = new Date();
  const activeTimeoutAt = new Date(now.getTime() + PAYMENT_LINE_ACTIVE_TIMEOUT_MS);

  const updated = await prisma.terminalPaymentDispatch.updateMany({
    where: {
      id: params.entryId,
      queueKey: params.deviceId,
      targetDeviceId: params.deviceId,
      status: 'PROCESSING'
    },
    data: {
      processingHeartbeatAt: now,
      activeTimeoutAt
    }
  });

  if (updated.count === 0) {
    throw new HttpError(409, 'Only active payment entries can be heartbeated');
  }

  return {
    ok: true,
    activeTimeoutAt: activeTimeoutAt.toISOString()
  };
}

export async function backToLineEntry(params: {
  entryId: string;
  reason?: string;
}): Promise<PaymentLineEntryView> {
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.terminalPaymentDispatch.findUnique({
      where: { id: params.entryId },
      select: {
        id: true,
        queueKey: true,
        status: true
      }
    });

    if (!current) {
      throw new HttpError(404, 'Payment line entry not found');
    }
    if (['SUCCEEDED', 'EXPIRED', 'CANCELED'].includes(current.status)) {
      throw new HttpError(409, `Entry is ${current.status} and cannot return to line`);
    }

    return withQueueAdvisoryLock({
      tx,
      queueKey: current.queueKey,
      action: async () =>
        tx.terminalPaymentDispatch.update({
          where: { id: current.id },
          data: {
            status: 'PENDING',
            queueSortAt: now,
            deliveredAt: null,
            processingStartedAt: null,
            processingHeartbeatAt: null,
            activeTimeoutAt: null,
            failureReason: params.reason ? params.reason.slice(0, 500) : current.status === 'FAILED' ? null : 'Moved to back of line'
          },
          select: paymentLineDispatchSelect
        })
    });
  });

  await publishQueueAndEntry(updated.queueKey, updated.id);
  return fetchPaymentLineEntry(updated.id);
}

export async function cancelPaymentLineEntry(params: {
  entryId: string;
  reason?: string;
}): Promise<PaymentLineEntryView> {
  const now = new Date();

  const current = await prisma.terminalPaymentDispatch.findUnique({
    where: { id: params.entryId },
    select: {
      id: true,
      queueKey: true,
      status: true,
      holdToken: true
    }
  });

  if (!current) {
    throw new HttpError(404, 'Payment line entry not found');
  }

  if (current.status !== 'SUCCEEDED' && current.status !== 'EXPIRED' && current.status !== 'CANCELED') {
    await releaseHoldByToken(current.holdToken).catch(() => undefined);
  }

  const updated =
    current.status === 'SUCCEEDED' || current.status === 'EXPIRED' || current.status === 'CANCELED'
      ? await prisma.terminalPaymentDispatch.findUniqueOrThrow({
          where: { id: current.id },
          select: paymentLineDispatchSelect
        })
      : await prisma.terminalPaymentDispatch.update({
          where: { id: current.id },
          data: {
            status: 'CANCELED',
            canceledAt: now,
            failureReason: params.reason?.slice(0, 500) || 'Canceled by operator',
            processingHeartbeatAt: null,
            activeTimeoutAt: null
          },
          select: paymentLineDispatchSelect
        });

  await publishQueueAndEntry(updated.queueKey, updated.id);
  return fetchPaymentLineEntry(updated.id);
}

export async function markPaymentLineEntryFailed(params: {
  entryId: string;
  reason: string;
}): Promise<PaymentLineEntryView> {
  const updated = await prisma.terminalPaymentDispatch.update({
    where: { id: params.entryId },
    data: {
      status: 'FAILED',
      failureReason: params.reason.slice(0, 500),
      processingHeartbeatAt: null,
      activeTimeoutAt: null
    },
    select: paymentLineDispatchSelect
  });

  await publishQueueAndEntry(updated.queueKey, updated.id);
  return fetchPaymentLineEntry(updated.id);
}

export async function expireTimedOutActivePaymentLineEntries(limit = 50): Promise<
  Array<{
    entryId: string;
    queueKey: string;
  }>
> {
  const now = new Date();
  const candidates = await prisma.terminalPaymentDispatch.findMany({
    where: {
      status: 'PROCESSING',
      activeTimeoutAt: {
        lte: now
      }
    },
    orderBy: [{ activeTimeoutAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 500)),
    select: {
      id: true,
      queueKey: true,
      holdToken: true
    }
  });

  if (candidates.length === 0) {
    return [];
  }

  const timedOut: Array<{ entryId: string; queueKey: string }> = [];

  for (const candidate of candidates) {
    const updated = await prisma.terminalPaymentDispatch.updateMany({
      where: {
        id: candidate.id,
        status: 'PROCESSING',
        activeTimeoutAt: {
          lte: now
        }
      },
      data: {
        status: 'FAILED',
        failureReason: 'Payment took too long',
        processingHeartbeatAt: null,
        activeTimeoutAt: null
      }
    });

    if (updated.count > 0) {
      await releaseHoldByToken(candidate.holdToken).catch(() => undefined);
      timedOut.push({
        entryId: candidate.id,
        queueKey: candidate.queueKey
      });
    }
  }

  return timedOut;
}

export async function extendWaitingPaymentLineHolds(limit = 100): Promise<{
  extendedCount: number;
  failedEntryIds: string[];
  touchedQueueKeys: string[];
}> {
  const now = new Date();
  const leadMs = env.PAYMENT_LINE_HOLD_EXTENSION_LEAD_SECONDS * 1_000;
  const refreshTarget = new Date(Date.now() + env.TERMINAL_DISPATCH_HOLD_TTL_MINUTES * 60_000);

  const candidates = await prisma.terminalPaymentDispatch.findMany({
    where: {
      status: { in: PAYMENT_LINE_WAITING_STATUSES },
      holdExpiresAt: { lte: new Date(now.getTime() + leadMs) }
    },
    orderBy: [{ holdExpiresAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 500)),
    select: {
      id: true,
      queueKey: true,
      holdToken: true,
      status: true
    }
  });

  if (candidates.length === 0) {
    return {
      extendedCount: 0,
      failedEntryIds: [],
      touchedQueueKeys: []
    };
  }

  let extendedCount = 0;
  const failedEntryIds: string[] = [];
  const touchedQueueKeys = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.holdToken.startsWith('ga_terminal_dispatch:')) {
      const updated = await prisma.terminalPaymentDispatch.updateMany({
        where: {
          id: candidate.id,
          status: { in: PAYMENT_LINE_WAITING_STATUSES }
        },
        data: {
          holdExpiresAt: refreshTarget
        }
      });

      if (updated.count > 0) {
        extendedCount += 1;
        touchedQueueKeys.add(candidate.queueKey);
      }
      continue;
    }

    const result = await prisma.$transaction(async (tx) => {
      const holdUpdated = await tx.holdSession.updateMany({
        where: {
          holdToken: candidate.holdToken,
          status: 'ACTIVE'
        },
        data: {
          expiresAt: refreshTarget
        }
      });

      if (holdUpdated.count === 0) {
        const failed = await tx.terminalPaymentDispatch.updateMany({
          where: {
            id: candidate.id,
            status: { in: PAYMENT_LINE_WAITING_STATUSES }
          },
          data: {
            status: 'FAILED',
            failureReason: 'Seat hold could not be extended',
            processingHeartbeatAt: null,
            activeTimeoutAt: null
          }
        });

        return {
          extended: false,
          failed: failed.count > 0
        };
      }

      const dispatchUpdated = await tx.terminalPaymentDispatch.updateMany({
        where: {
          id: candidate.id,
          status: { in: PAYMENT_LINE_WAITING_STATUSES }
        },
        data: {
          holdExpiresAt: refreshTarget
        }
      });

      return {
        extended: dispatchUpdated.count > 0,
        failed: false
      };
    });

    if (result.extended) {
      extendedCount += 1;
      touchedQueueKeys.add(candidate.queueKey);
    } else if (result.failed) {
      failedEntryIds.push(candidate.id);
      touchedQueueKeys.add(candidate.queueKey);
      await releaseHoldByToken(candidate.holdToken).catch(() => undefined);
    }
  }

  return {
    extendedCount,
    failedEntryIds,
    touchedQueueKeys: [...touchedQueueKeys]
  };
}

export async function publishQueueSnapshot(queueKey: string): Promise<PaymentLineSnapshot> {
  const snapshot = await fetchPaymentLineSnapshot(queueKey);
  broadcastPaymentLineEvent(queueKey, 'queue_snapshot', snapshot);
  return snapshot;
}

export async function publishQueueAndEntry(queueKey: string, entryId: string): Promise<void> {
  const snapshot = await fetchPaymentLineSnapshot(queueKey);
  const entry = await fetchPaymentLineEntry(entryId);

  broadcastPaymentLineEvent(queueKey, 'queue_snapshot', snapshot);
  broadcastPaymentLineEvent(queueKey, 'entry_updated', {
    entryId: entry.entryId,
    position: entry.position,
    waitingCount: entry.waitingCount,
    nowServingEntryId: entry.nowServingEntryId,
    isYourTurn: entry.isYourTurn,
    isNext: entry.isNext,
    uiState: entry.uiState,
    updatedAt: entry.updatedAt,
    status: entry.status,
    failureReason: entry.failureReason
  });
}

export async function publishNowServingChanged(queueKey: string, nowServingEntryId: string | null): Promise<void> {
  broadcastPaymentLineEvent(queueKey, 'now_serving_changed', {
    queueKey,
    nowServingEntryId,
    updatedAt: new Date().toISOString()
  });
}

export async function publishEntryRemoved(queueKey: string, entryId: string): Promise<void> {
  broadcastPaymentLineEvent(queueKey, 'entry_removed', {
    queueKey,
    entryId,
    updatedAt: new Date().toISOString()
  });
}

export async function publishActiveTimeout(queueKey: string, entryId: string): Promise<void> {
  broadcastPaymentLineEvent(queueKey, 'active_timeout', {
    queueKey,
    entryId,
    message: 'Payment took too long',
    updatedAt: new Date().toISOString()
  });
}
