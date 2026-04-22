/*
Handoff note for Mr. Smith:
- File: `backend/src/services/ticket-email-outbox-service.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import type { TicketEmailPayload } from '../lib/email.js';
import type { Prisma, TicketEmailOutbox } from '@prisma/client';

const MAX_ERROR_LENGTH = 2000;

function trimError(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Unknown email outbox error';
  }
  return trimmed.length > MAX_ERROR_LENGTH ? `${trimmed.slice(0, MAX_ERROR_LENGTH - 1)}…` : trimmed;
}

function retryDelayMs(attemptCount: number): number {
  const baseMs = env.TICKET_EMAIL_OUTBOX_RETRY_BASE_SECONDS * 1000;
  const exponent = Math.min(6, Math.max(0, attemptCount - 1));
  return baseMs * (2 ** exponent);
}

export async function enqueueTicketEmailOutbox(
  tx: Prisma.TransactionClient,
  params: {
    orderId: string;
    payload: TicketEmailPayload;
  }
): Promise<void> {
  await tx.ticketEmailOutbox.upsert({
    where: {
      orderId: params.orderId
    },
    create: {
      orderId: params.orderId,
      payloadJson: params.payload,
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      lastError: null,
      sentAt: null
    },
    update: {
      payloadJson: params.payload,
      status: 'PENDING',
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      lastError: null,
      sentAt: null
    }
  });
}

export async function claimNextTicketEmailOutbox(): Promise<TicketEmailOutbox | null> {
  const rows = await prisma.$queryRaw<TicketEmailOutbox[]>`
    WITH candidate AS (
      SELECT "id"
      FROM "TicketEmailOutbox"
      WHERE "status" = 'PENDING'::"TicketEmailOutboxStatus"
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "TicketEmailOutbox" AS outbox
    SET
      "status" = 'PROCESSING'::"TicketEmailOutboxStatus",
      "processingStartedAt" = NOW(),
      "attemptCount" = outbox."attemptCount" + 1,
      "updatedAt" = NOW()
    FROM candidate
    WHERE outbox."id" = candidate."id"
    RETURNING outbox.*
  `;

  return rows[0] || null;
}

export async function markTicketEmailOutboxSent(id: string): Promise<void> {
  await prisma.ticketEmailOutbox.update({
    where: { id },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      processingStartedAt: null,
      nextAttemptAt: null,
      lastError: null
    }
  });
}

export async function markTicketEmailOutboxFailed(params: {
  id: string;
  attemptCount: number;
  errorMessage: string;
}): Promise<void> {
  const lastError = trimError(params.errorMessage);

  if (params.attemptCount >= env.TICKET_EMAIL_OUTBOX_MAX_ATTEMPTS) {
    await prisma.ticketEmailOutbox.update({
      where: { id: params.id },
      data: {
        status: 'FAILED',
        processingStartedAt: null,
        nextAttemptAt: null,
        lastError
      }
    });
    return;
  }

  const nextAttemptAt = new Date(Date.now() + retryDelayMs(params.attemptCount));
  await prisma.ticketEmailOutbox.update({
    where: { id: params.id },
    data: {
      status: 'PENDING',
      processingStartedAt: null,
      nextAttemptAt,
      lastError
    }
  });
}

export async function recoverStaleTicketEmailOutboxJobs(): Promise<number> {
  const threshold = new Date(Date.now() - env.TICKET_EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS * 1000);
  const result = await prisma.ticketEmailOutbox.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: threshold } }]
    },
    data: {
      status: 'PENDING',
      processingStartedAt: null,
      nextAttemptAt: new Date()
    }
  });

  return result.count;
}
