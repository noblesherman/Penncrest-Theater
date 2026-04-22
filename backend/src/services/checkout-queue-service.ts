/*
Handoff note for Mr. Smith:
- File: `backend/src/services/checkout-queue-service.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { CheckoutQueueItem, CheckoutQueueStatus, Prisma } from '@prisma/client';
import { checkoutRequestSchema } from '../schemas/checkout.js';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import type { CheckoutExecutionResult, CheckoutRequestPayload } from './checkout-execution-service.js';

const TRANSIENT_ERROR_CODES = new Set([
  'PAYMENT_PROVIDER_TEMPORARY_ERROR',
  'NETWORK_RETRYABLE_ERROR'
]);

const TERMINAL_QUEUE_STATUSES: CheckoutQueueStatus[] = ['FAILED', 'EXPIRED', 'CANCELED'];

type QueueFailureReasonCode =
  | 'QUEUE_TIMEOUT'
  | 'HOLD_EXPIRED'
  | 'PAYMENT_PROVIDER_TEMPORARY_ERROR'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'NETWORK_RETRYABLE_ERROR'
  | 'CHECKOUT_VALIDATION_FAILED'
  | 'CHECKOUT_CONFLICT'
  | 'INTERNAL_ERROR'
  | 'REQUEST_CANCELED';

type QueueFailureReason = {
  code: QueueFailureReasonCode;
  message: string;
};

export type CheckoutQueueEnqueueResponse = {
  status: 'QUEUED';
  queueId: string;
  position: number;
  estimatedWaitSeconds: number;
  refreshAfterMs: number;
};

export type CheckoutQueueStatusWaitingResponse = {
  status: 'WAITING';
  queueId: string;
  position: number;
  estimatedWaitSeconds: number;
  refreshAfterMs: number;
};

export type CheckoutQueueStatusReadyResponse = {
  status: 'READY';
  queueId: string;
  orderId: string;
  orderAccessToken: string;
  clientSecret?: string;
  publishableKey?: string;
  mode: CheckoutRequestPayload['checkoutMode'];
};

export type CheckoutQueueStatusTerminalResponse = {
  status: 'FAILED' | 'EXPIRED';
  queueId: string;
  reason: QueueFailureReasonCode;
  message: string;
};

export type CheckoutQueueStatusResponse =
  | CheckoutQueueStatusWaitingResponse
  | CheckoutQueueStatusReadyResponse
  | CheckoutQueueStatusTerminalResponse;

export type CheckoutQueueMetrics = {
  waitingCount: number;
  processingCount: number;
  oldestWaitingAgeSeconds: number;
  readyCountLastFiveMinutes: number;
  failedCountLastFiveMinutes: number;
};

function queueMaxWaitMs(): number {
  return env.CHECKOUT_QUEUE_MAX_WAIT_SECONDS * 1000;
}

function pollWindowMs(): { minMs: number; maxMs: number } {
  const minMs = Math.max(250, env.CHECKOUT_QUEUE_POLL_MIN_MS);
  const maxMs = Math.max(minMs, env.CHECKOUT_QUEUE_POLL_MAX_MS);
  return { minMs, maxMs };
}

function randomPollDelayMs(): number {
  const { minMs, maxMs } = pollWindowMs();
  if (minMs === maxMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asPayload(jsonValue: Prisma.JsonValue): CheckoutRequestPayload {
  const parsed = checkoutRequestSchema.safeParse(jsonValue);
  if (!parsed.success) {
    throw new HttpError(500, 'Queued checkout payload is invalid');
  }

  return parsed.data;
}

function encodeFailureReason(reason: QueueFailureReason): string {
  return `${reason.code}:${reason.message}`;
}

function decodeFailureReason(rawReason: string | null): QueueFailureReason {
  if (!rawReason) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Checkout could not be completed. Please try again.'
    };
  }

  const separatorIndex = rawReason.indexOf(':');
  if (separatorIndex <= 0) {
    return {
      code: 'INTERNAL_ERROR',
      message: rawReason
    };
  }

  const code = rawReason.slice(0, separatorIndex) as QueueFailureReasonCode;
  const message = rawReason.slice(separatorIndex + 1).trim() || 'Checkout could not be completed. Please try again.';
  return { code, message };
}

function toTerminalResponse(queueItem: CheckoutQueueItem): CheckoutQueueStatusTerminalResponse {
  const decoded = decodeFailureReason(queueItem.failedReason);
  return {
    status: queueItem.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED',
    queueId: queueItem.id,
    reason: decoded.code,
    message: decoded.message
  };
}

function estimateWaitSeconds(position: number): number {
  if (position <= 1) {
    return 0;
  }

  const avgSecondsPerCheckout = 7;
  const batchesAhead = Math.max(0, position - 1) / Math.max(1, env.CHECKOUT_MAX_ACTIVE);
  return Math.max(1, Math.ceil(batchesAhead * avgSecondsPerCheckout));
}

async function validatePaidQueueRequest(payload: CheckoutRequestPayload): Promise<void> {
  const uniqueSeatIds = [...new Set(payload.seatIds)];

  const [performance, holdSession] = await Promise.all([
    prisma.performance.findFirst({
      where: { id: payload.performanceId, isArchived: false },
      select: { id: true, startsAt: true, onlineSalesStartsAt: true, salesCutoffAt: true, isPublished: true }
    }),
    prisma.holdSession.findUnique({
      where: { holdToken: payload.holdToken },
      include: {
        seatHolds: {
          select: { seatId: true }
        }
      }
    })
  ]);

  if (!performance) {
    throw new HttpError(404, 'Performance not found');
  }

  if (!performance.isPublished || (performance.onlineSalesStartsAt && performance.onlineSalesStartsAt > new Date())) {
    throw new HttpError(400, 'Online sales are not live for this performance yet');
  }

  const salesCutoffAt = performance.salesCutoffAt || performance.startsAt;
  if (salesCutoffAt <= new Date()) {
    throw new HttpError(400, 'Online sales are closed for this performance');
  }

  if (!holdSession || holdSession.performanceId !== payload.performanceId || holdSession.clientToken !== payload.clientToken) {
    throw new HttpError(400, 'Invalid hold token for this session');
  }

  if (holdSession.status !== 'ACTIVE' || holdSession.expiresAt < new Date()) {
    throw new HttpError(400, 'Hold expired');
  }

  const heldSeatIds = holdSession.seatHolds.map((seat) => seat.seatId).sort();
  if (heldSeatIds.length !== uniqueSeatIds.length || heldSeatIds.join(',') !== uniqueSeatIds.sort().join(',')) {
    throw new HttpError(400, 'Held seats do not match checkout request');
  }
}

async function queuePositionFor(item: Pick<CheckoutQueueItem, 'id' | 'performanceId' | 'createdAt'>): Promise<number> {
  const now = new Date();
  const ahead = await prisma.checkoutQueueItem.count({
    where: {
      performanceId: item.performanceId,
      status: 'WAITING',
      expiresAt: { gt: now },
      AND: [
        {
          OR: [
            { createdAt: { lt: item.createdAt } },
            {
              createdAt: item.createdAt,
              id: { lte: item.id }
            }
          ]
        },
        {
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
        }
      ]
    }
  });

  return Math.max(1, ahead);
}

async function extendQueueAndHoldWhileWaiting(queueItem: CheckoutQueueItem): Promise<void> {
  const now = Date.now();
  const maxDeadlineMs = queueItem.createdAt.getTime() + queueMaxWaitMs();
  const nextExpiryMs = Math.min(maxDeadlineMs, now + env.HOLD_TTL_MINUTES * 60_000);

  await prisma.$transaction(async (tx) => {
    await tx.checkoutQueueItem.update({
      where: { id: queueItem.id },
      data: {
        expiresAt: new Date(nextExpiryMs)
      }
    });

    await tx.holdSession.updateMany({
      where: {
        holdToken: queueItem.holdToken,
        clientToken: queueItem.clientToken,
        status: 'ACTIVE'
      },
      data: {
        expiresAt: new Date(nextExpiryMs)
      }
    });
  });
}

export async function enqueuePaidCheckout(payload: CheckoutRequestPayload): Promise<CheckoutQueueEnqueueResponse> {
  if (payload.checkoutMode !== 'PAID') {
    throw new HttpError(400, 'Queue only supports paid checkout mode');
  }

  let queueItem = await prisma.checkoutQueueItem.findUnique({
    where: {
      holdToken_clientToken: {
        holdToken: payload.holdToken,
        clientToken: payload.clientToken
      }
    }
  });

  if (!queueItem || TERMINAL_QUEUE_STATUSES.includes(queueItem.status)) {
    await validatePaidQueueRequest(payload);

    const now = new Date();
    const defaultExpiry = new Date(now.getTime() + queueMaxWaitMs());
    const upsertWaitingState = {
      performanceId: payload.performanceId,
      requestPayloadJson: toPrismaJson(payload),
      status: 'WAITING' as const,
      expiresAt: defaultExpiry,
      processingStartedAt: null,
      readyAt: null,
      failedReason: null,
      orderId: null,
      paymentIntentId: null,
      clientSecret: null,
      nextAttemptAt: null
    };

    if (!queueItem) {
      try {
        queueItem = await prisma.checkoutQueueItem.create({
          data: {
            holdToken: payload.holdToken,
            clientToken: payload.clientToken,
            attemptCount: 0,
            ...upsertWaitingState
          }
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
          throw err;
        }

        queueItem = await prisma.checkoutQueueItem.findUnique({
          where: {
            holdToken_clientToken: {
              holdToken: payload.holdToken,
              clientToken: payload.clientToken
            }
          }
        });
      }
    } else {
      queueItem = await prisma.checkoutQueueItem.update({
        where: { id: queueItem.id },
        data: {
          attemptCount: 0,
          ...upsertWaitingState
        }
      });
    }

    await prisma.holdSession.updateMany({
      where: {
        holdToken: payload.holdToken,
        clientToken: payload.clientToken,
        status: 'ACTIVE'
      },
      data: {
        expiresAt: defaultExpiry
      }
    });
  }

  if (!queueItem) {
    throw new HttpError(500, 'We could not create checkout queue item');
  }

  const position = queueItem.status === 'READY' || queueItem.status === 'PROCESSING' ? 1 : await queuePositionFor(queueItem);

  return {
    status: 'QUEUED',
    queueId: queueItem.id,
    position,
    estimatedWaitSeconds: queueItem.status === 'READY' ? 0 : estimateWaitSeconds(position),
    refreshAfterMs: randomPollDelayMs()
  };
}

async function queueItemForClient(params: {
  queueId: string;
  holdToken: string;
  clientToken: string;
}): Promise<CheckoutQueueItem> {
  const queueItem = await prisma.checkoutQueueItem.findUnique({ where: { id: params.queueId } });
  if (!queueItem || queueItem.holdToken !== params.holdToken || queueItem.clientToken !== params.clientToken) {
    throw new HttpError(404, 'Queue item not found');
  }

  return queueItem;
}

export async function getCheckoutQueueStatus(params: {
  queueId: string;
  holdToken: string;
  clientToken: string;
}): Promise<CheckoutQueueStatusResponse> {
  let queueItem = await queueItemForClient(params);

  if (queueItem.status === 'READY') {
    const payload = asPayload(queueItem.requestPayloadJson);
    if (!queueItem.orderId) {
      throw new HttpError(500, 'Checkout queue item is missing order details');
    }
    const order = await prisma.order.findUnique({
      where: { id: queueItem.orderId },
      select: { accessToken: true }
    });
    if (!order) {
      throw new HttpError(500, 'Checkout queue item references a missing order');
    }

    return {
      status: 'READY',
      queueId: queueItem.id,
      orderId: queueItem.orderId,
      orderAccessToken: order.accessToken,
      clientSecret: queueItem.clientSecret || undefined,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || undefined,
      mode: payload.checkoutMode
    };
  }

  if (TERMINAL_QUEUE_STATUSES.includes(queueItem.status)) {
    return toTerminalResponse(queueItem);
  }

  const now = new Date();
  if (queueItem.expiresAt <= now) {
    queueItem = await prisma.checkoutQueueItem.update({
      where: { id: queueItem.id },
      data: {
        status: 'EXPIRED',
        failedReason: encodeFailureReason({
          code: 'QUEUE_TIMEOUT',
          message: 'Checkout wait time expired. Please reselect your seats and try again.'
        })
      }
    });

    return toTerminalResponse(queueItem);
  }

  const holdSession = await prisma.holdSession.findUnique({
    where: { holdToken: queueItem.holdToken },
    select: {
      status: true,
      expiresAt: true,
      clientToken: true,
      performanceId: true
    }
  });

  if (!holdSession || holdSession.clientToken !== queueItem.clientToken || holdSession.status !== 'ACTIVE' || holdSession.expiresAt <= now) {
    queueItem = await prisma.checkoutQueueItem.update({
      where: { id: queueItem.id },
      data: {
        status: 'EXPIRED',
        failedReason: encodeFailureReason({
          code: 'HOLD_EXPIRED',
          message: 'Your seat hold expired while waiting. Please reselect seats to continue.'
        })
      }
    });

    return toTerminalResponse(queueItem);
  }

  await extendQueueAndHoldWhileWaiting(queueItem);
  queueItem = await prisma.checkoutQueueItem.findUniqueOrThrow({ where: { id: queueItem.id } });

  if (queueItem.status === 'READY') {
    const payload = asPayload(queueItem.requestPayloadJson);
    if (!queueItem.orderId) {
      throw new HttpError(500, 'Checkout queue item is missing order details');
    }
    const order = await prisma.order.findUnique({
      where: { id: queueItem.orderId },
      select: { accessToken: true }
    });
    if (!order) {
      throw new HttpError(500, 'Checkout queue item references a missing order');
    }

    return {
      status: 'READY',
      queueId: queueItem.id,
      orderId: queueItem.orderId,
      orderAccessToken: order.accessToken,
      clientSecret: queueItem.clientSecret || undefined,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || undefined,
      mode: payload.checkoutMode
    };
  }

  if (TERMINAL_QUEUE_STATUSES.includes(queueItem.status)) {
    return toTerminalResponse(queueItem);
  }

  const position = queueItem.status === 'PROCESSING' ? 1 : await queuePositionFor(queueItem);
  return {
    status: 'WAITING',
    queueId: queueItem.id,
    position,
    estimatedWaitSeconds: estimateWaitSeconds(position),
    refreshAfterMs: randomPollDelayMs()
  };
}

export async function claimNextCheckoutQueueItem(): Promise<CheckoutQueueItem | null> {
  const rows = await prisma.$queryRaw<CheckoutQueueItem[]>`
    WITH candidate AS (
      SELECT "id"
      FROM "CheckoutQueueItem"
      WHERE "status" = 'WAITING'::"CheckoutQueueStatus"
        AND "expiresAt" > NOW()
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "CheckoutQueueItem" AS queue
    SET
      "status" = 'PROCESSING'::"CheckoutQueueStatus",
      "processingStartedAt" = NOW(),
      "attemptCount" = queue."attemptCount" + 1,
      "updatedAt" = NOW()
    FROM candidate
    WHERE queue."id" = candidate."id"
    RETURNING queue.*
  `;

  return rows[0] || null;
}

export async function recoverStaleProcessingQueueItems(maxProcessingAgeMs: number): Promise<number> {
  const threshold = new Date(Date.now() - maxProcessingAgeMs);
  const result = await prisma.checkoutQueueItem.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: threshold } }]
    },
    data: {
      status: 'WAITING',
      processingStartedAt: null,
      nextAttemptAt: new Date()
    }
  });

  return result.count;
}

export async function expireTimedOutQueueItems(): Promise<number> {
  const now = new Date();
  const result = await prisma.checkoutQueueItem.updateMany({
    where: {
      status: {
        in: ['WAITING', 'PROCESSING']
      },
      expiresAt: { lte: now }
    },
    data: {
      status: 'EXPIRED',
      failedReason: encodeFailureReason({
        code: 'QUEUE_TIMEOUT',
        message: 'Checkout wait time expired. Please reselect your seats and try again.'
      }),
      processingStartedAt: null
    }
  });

  return result.count;
}

export async function markQueueItemReady(params: {
  queueId: string;
  result: CheckoutExecutionResult;
}): Promise<void> {
  await prisma.checkoutQueueItem.update({
    where: { id: params.queueId },
    data: {
      status: 'READY',
      readyAt: new Date(),
      failedReason: null,
      orderId: params.result.orderId,
      paymentIntentId: params.result.paymentIntentId || null,
      clientSecret: params.result.clientSecret || null,
      processingStartedAt: null,
      nextAttemptAt: null
    }
  });
}

export async function requeueQueueItemForRetry(params: {
  queueId: string;
  reason: QueueFailureReason;
  retryAt: Date;
}): Promise<void> {
  await prisma.checkoutQueueItem.update({
    where: { id: params.queueId },
    data: {
      status: 'WAITING',
      failedReason: encodeFailureReason(params.reason),
      processingStartedAt: null,
      nextAttemptAt: params.retryAt
    }
  });
}

export async function markQueueItemFailed(params: {
  queueId: string;
  reason: QueueFailureReason;
  expired?: boolean;
}): Promise<void> {
  await prisma.checkoutQueueItem.update({
    where: { id: params.queueId },
    data: {
      status: params.expired ? 'EXPIRED' : 'FAILED',
      failedReason: encodeFailureReason(params.reason),
      processingStartedAt: null,
      nextAttemptAt: null
    }
  });
}

export function classifyQueueProcessingError(err: unknown): QueueFailureReason {
  if (err instanceof HttpError) {
    if (/hold expired/i.test(err.message)) {
      return {
        code: 'HOLD_EXPIRED',
        message: 'Your seat hold expired while waiting. Please reselect seats to continue.'
      };
    }

    if (err.statusCode === 409) {
      return {
        code: 'CHECKOUT_CONFLICT',
        message: err.message || 'Selected seats are no longer available. Please reselect seats.'
      };
    }

    if (err.statusCode >= 400 && err.statusCode < 500) {
      return {
        code: 'CHECKOUT_VALIDATION_FAILED',
        message: err.message || 'Checkout request was invalid. Please review your selections and try again.'
      };
    }
  }

  if (err instanceof Error) {
    const lowerMessage = err.message.toLowerCase();
    const rawCode = String((err as { code?: unknown }).code || '').toLowerCase();

    if (
      rawCode.includes('rate_limit') ||
      lowerMessage.includes('rate limit exceeded') ||
      lowerMessage.includes('too many requests')
    ) {
      return {
        code: 'PAYMENT_PROVIDER_TEMPORARY_ERROR',
        message: 'Payment provider is temporarily unavailable. Retrying your checkout...'
      };
    }

    if (/StripeRateLimitError|StripeAPIError|StripeConnectionError|APIConnectionError/i.test(err.name)) {
      return {
        code: 'PAYMENT_PROVIDER_TEMPORARY_ERROR',
        message: 'Payment provider is temporarily unavailable. Retrying your checkout...'
      };
    }

    if (/Stripe/i.test(err.name)) {
      return {
        code: 'PAYMENT_PROVIDER_ERROR',
        message: err.message || 'Payment provider rejected this checkout. Please try again.'
      };
    }

    if (/ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|network/i.test(err.message)) {
      return {
        code: 'NETWORK_RETRYABLE_ERROR',
        message: 'Temporary network issue while preparing checkout. Retrying...'
      };
    }

    return {
      code: 'INTERNAL_ERROR',
      message: err.message || 'Unexpected checkout error. Please try again.'
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Unexpected checkout error. Please try again.'
  };
}

export function shouldRetryQueueFailure(reason: QueueFailureReason, attemptCount: number): boolean {
  return attemptCount < 3 && TRANSIENT_ERROR_CODES.has(reason.code);
}

export function retryBackoffMs(attemptCount: number): number {
  const baseMs = 1000;
  const cappedExponent = Math.min(4, Math.max(0, attemptCount - 1));
  return baseMs * (2 ** cappedExponent);
}

export async function loadCheckoutPayloadForQueueItem(queueItem: CheckoutQueueItem): Promise<CheckoutRequestPayload> {
  return asPayload(queueItem.requestPayloadJson);
}

export async function getCheckoutQueueMetrics(now: Date = new Date()): Promise<CheckoutQueueMetrics> {
  const [waitingCount, processingCount, oldestWaiting, readyCountLastFiveMinutes, failedCountLastFiveMinutes] = await Promise.all([
    prisma.checkoutQueueItem.count({
      where: {
        status: 'WAITING',
        expiresAt: { gt: now }
      }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: 'PROCESSING'
      }
    }),
    prisma.checkoutQueueItem.findFirst({
      where: {
        status: 'WAITING',
        expiresAt: { gt: now }
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: 'READY',
        readyAt: {
          gte: new Date(now.getTime() - 5 * 60_000)
        }
      }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: {
          in: ['FAILED', 'EXPIRED']
        },
        updatedAt: {
          gte: new Date(now.getTime() - 5 * 60_000)
        }
      }
    })
  ]);

  const oldestWaitingAgeSeconds = oldestWaiting ? Math.max(0, Math.floor((now.getTime() - oldestWaiting.createdAt.getTime()) / 1000)) : 0;

  return {
    waitingCount,
    processingCount,
    oldestWaitingAgeSeconds,
    readyCountLastFiveMinutes,
    failedCountLastFiveMinutes
  };
}
