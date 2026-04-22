/*
Handoff note for Mr. Smith:
- File: `backend/src/services/terminal-dispatch-service.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import crypto from 'node:crypto';
import { TerminalDispatchStatus } from '@prisma/client';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { releaseHoldByToken, syncSeatHold } from './hold-service.js';

export const TERMINAL_DEVICE_ACTIVE_WINDOW_MS = 70_000;
export const TERMINAL_NEXT_DISPATCH_WAIT_MS = 25_000;

export const TERMINAL_DISPATCH_ACTIVE_STATUSES: TerminalDispatchStatus[] = ['PENDING', 'DELIVERED', 'PROCESSING'];
export const TERMINAL_DISPATCH_BUSY_STATUSES: TerminalDispatchStatus[] = ['PROCESSING'];
const TERMINAL_DISPATCH_EXPIRABLE_STATUSES: TerminalDispatchStatus[] = ['PENDING', 'DELIVERED', 'PROCESSING', 'FAILED'];

const terminalDispatchSnapshotSchema = z.object({
  performanceId: z.string().min(1),
  performanceTitle: z.string().min(1),
  isGeneralAdmission: z.boolean(),
  seatIds: z.array(z.string().min(1)).min(1),
  seatLabelsBySeatId: z.record(z.string().min(1), z.string().min(1)),
  seatSummaryBySeatId: z.record(
    z.string().min(1),
    z.object({
      label: z.string().min(1),
      sectionName: z.string().min(1),
      row: z.string().min(1),
      number: z.number().int().min(0)
    })
  ),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)),
  attendeeNamesBySeatId: z.record(z.string().min(1), z.string().max(80)).optional(),
  ticketTypeBySeatId: z.record(z.string().min(1), z.string().min(1)),
  priceBySeatId: z.record(z.string().min(1), z.number().int().min(0)),
  customerName: z.string().min(1),
  receiptEmail: z.string().email().nullable(),
  sendReceipt: z.boolean(),
  expectedAmountCents: z.number().int().min(0),
  currency: z.literal('usd')
});

export type TerminalDispatchSnapshot = z.infer<typeof terminalDispatchSnapshotSchema>;

function dedupeSeatIds(seatIds: string[]): string[] {
  return [...new Set(seatIds)];
}

export function parseTerminalDispatchSnapshot(value: unknown): TerminalDispatchSnapshot {
  const parsed = terminalDispatchSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(500, 'Terminal dispatch snapshot is invalid');
  }
  return parsed.data;
}

function isStatusExpirable(status: TerminalDispatchStatus): boolean {
  return TERMINAL_DISPATCH_EXPIRABLE_STATUSES.includes(status);
}

function shouldExpireDispatch(dispatch: {
  status: TerminalDispatchStatus;
  holdExpiresAt: Date;
}, now: Date): boolean {
  return isStatusExpirable(dispatch.status) && dispatch.holdExpiresAt.getTime() <= now.getTime();
}

async function expireDispatchById(dispatchId: string): Promise<boolean> {
  const now = new Date();
  const dispatch = await prisma.terminalPaymentDispatch.findUnique({
    where: { id: dispatchId },
    select: {
      id: true,
      status: true,
      holdToken: true,
      holdExpiresAt: true
    }
  });

  if (!dispatch || !shouldExpireDispatch(dispatch, now)) {
    return false;
  }

  const updated = await prisma.terminalPaymentDispatch.updateMany({
    where: {
      id: dispatch.id,
      status: { in: TERMINAL_DISPATCH_EXPIRABLE_STATUSES },
      holdExpiresAt: { lte: now }
    },
    data: {
      status: 'EXPIRED',
      failureReason: 'Seat hold expired',
      activeTimeoutAt: null,
      processingHeartbeatAt: null
    }
  });

  if (updated.count > 0) {
    await releaseHoldByToken(dispatch.holdToken).catch(() => undefined);
    return true;
  }

  return false;
}

export async function expireTerminalDispatchIfNeeded(dispatchId: string): Promise<void> {
  await expireDispatchById(dispatchId);
}

export async function expireExpiredTerminalDispatches(limit = 100): Promise<number> {
  const now = new Date();
  const candidates = await prisma.terminalPaymentDispatch.findMany({
    where: {
      status: { in: TERMINAL_DISPATCH_EXPIRABLE_STATUSES },
      holdExpiresAt: { lte: now }
    },
    orderBy: { holdExpiresAt: 'asc' },
    take: Math.max(1, Math.min(limit, 500)),
    select: {
      id: true
    }
  });

  if (candidates.length === 0) {
    return 0;
  }

  let expired = 0;
  for (const candidate of candidates) {
    if (await expireDispatchById(candidate.id)) {
      expired += 1;
    }
  }

  return expired;
}

export async function expireDeviceDispatches(deviceId: string): Promise<number> {
  const candidates = await prisma.terminalPaymentDispatch.findMany({
    where: {
      targetDeviceId: deviceId,
      status: { in: TERMINAL_DISPATCH_EXPIRABLE_STATUSES }
    },
    select: { id: true }
  });

  let expired = 0;
  for (const candidate of candidates) {
    if (await expireDispatchById(candidate.id)) {
      expired += 1;
    }
  }

  return expired;
}

export async function createTerminalDispatchHold(params: {
  performanceId: string;
  seatIds: string[];
}): Promise<{ holdToken: string; holdExpiresAt: Date }> {
  const normalizedSeatIds = dedupeSeatIds(params.seatIds);
  const holdExpiresAt = new Date(Date.now() + env.TERMINAL_DISPATCH_HOLD_TTL_MINUTES * 60_000);
  if (normalizedSeatIds.length === 0) {
    return {
      holdToken: `ga_terminal_dispatch:${crypto.randomBytes(8).toString('hex')}`,
      holdExpiresAt
    };
  }

  const clientToken = `terminal_dispatch:${crypto.randomBytes(8).toString('hex')}`;
  const hold = await syncSeatHold({
    performanceId: params.performanceId,
    seatIds: normalizedSeatIds,
    clientToken
  });

  await prisma.holdSession.update({
    where: { holdToken: hold.holdToken },
    data: {
      expiresAt: holdExpiresAt,
      status: 'ACTIVE'
    }
  });

  return {
    holdToken: hold.holdToken,
    holdExpiresAt
  };
}

export async function registerTerminalDeviceSession(params: {
  deviceId: string;
  displayName: string;
  registeredByAdminId?: string | null;
}) {
  const now = new Date();

  return prisma.terminalDeviceSession.upsert({
    where: { deviceId: params.deviceId },
    create: {
      deviceId: params.deviceId,
      displayName: params.displayName,
      isOnline: true,
      registeredByAdminId: params.registeredByAdminId || null,
      lastHeartbeatAt: now,
      lastDispatchPollAt: now
    },
    update: {
      displayName: params.displayName,
      isOnline: true,
      registeredByAdminId: params.registeredByAdminId || null,
      lastHeartbeatAt: now,
      lastDispatchPollAt: now
    }
  });
}

export async function heartbeatTerminalDeviceSession(deviceId: string): Promise<void> {
  const updated = await prisma.terminalDeviceSession.updateMany({
    where: { deviceId },
    data: {
      isOnline: true,
      lastHeartbeatAt: new Date()
    }
  });

  if (updated.count === 0) {
    throw new HttpError(404, 'Terminal device is not registered');
  }
}

export async function touchTerminalDispatchPoll(deviceId: string): Promise<void> {
  await prisma.terminalDeviceSession.updateMany({
    where: { deviceId },
    data: {
      isOnline: true,
      lastDispatchPollAt: new Date()
    }
  });
}

export async function listActiveTerminalDeviceSessions() {
  const cutoff = new Date(Date.now() - TERMINAL_DEVICE_ACTIVE_WINDOW_MS);

  await prisma.terminalDeviceSession.updateMany({
    where: {
      isOnline: true,
      lastHeartbeatAt: { lt: cutoff }
    },
    data: {
      isOnline: false
    }
  });

  return prisma.terminalDeviceSession.findMany({
    where: {
      isOnline: true,
      lastHeartbeatAt: { gte: cutoff }
    },
    orderBy: [{ displayName: 'asc' }, { lastHeartbeatAt: 'desc' }]
  });
}

export async function getActiveTerminalDeviceSession(deviceId: string) {
  const cutoff = new Date(Date.now() - TERMINAL_DEVICE_ACTIVE_WINDOW_MS);

  const session = await prisma.terminalDeviceSession.findUnique({
    where: { deviceId }
  });

  if (!session) {
    throw new HttpError(404, 'Terminal device not found');
  }

  if (!session.isOnline || session.lastHeartbeatAt < cutoff) {
    throw new HttpError(409, 'Selected terminal is offline');
  }

  return session;
}

export async function isTerminalDeviceBusy(params: {
  deviceId: string;
  excludeDispatchId?: string;
}): Promise<boolean> {
  const busy = await prisma.terminalPaymentDispatch.findFirst({
    where: {
      targetDeviceId: params.deviceId,
      status: { in: TERMINAL_DISPATCH_BUSY_STATUSES },
      ...(params.excludeDispatchId
        ? {
            id: {
              not: params.excludeDispatchId
            }
          }
        : {})
    },
    select: { id: true }
  });

  return Boolean(busy);
}
