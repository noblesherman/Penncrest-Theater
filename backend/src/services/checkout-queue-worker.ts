/*
Handoff note for Mr. Smith:
- File: `backend/src/services/checkout-queue-worker.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import type { FastifyBaseLogger } from 'fastify';
import type { CheckoutQueueItem } from '@prisma/client';
import { env } from '../lib/env.js';
import { executeCheckoutRequest } from './checkout-execution-service.js';
import {
  claimNextCheckoutQueueItem,
  classifyQueueProcessingError,
  expireTimedOutQueueItems,
  getCheckoutQueueMetrics,
  loadCheckoutPayloadForQueueItem,
  markQueueItemFailed,
  markQueueItemReady,
  recoverStaleProcessingQueueItems,
  requeueQueueItemForRetry,
  retryBackoffMs,
  shouldRetryQueueFailure
} from './checkout-queue-service.js';

const STALE_PROCESSING_MAX_AGE_MS = 2 * 60_000;
const DISPATCH_TICK_MS = 200;
const EXPIRY_SWEEP_INTERVAL_MS = 1000;
const METRICS_LOG_INTERVAL_MS = 15_000;

export type CheckoutQueueWorkerController = {
  stop: () => Promise<void>;
};

export type StartCheckoutQueueWorkerOptions = {
  unrefTimers?: boolean;
};

export function startCheckoutQueueWorker(
  logger: FastifyBaseLogger,
  options: StartCheckoutQueueWorkerOptions = {}
): CheckoutQueueWorkerController {
  const unrefTimers = options.unrefTimers ?? true;
  let stopped = false;
  let activeCount = 0;
  let dispatchTimer: NodeJS.Timeout | null = null;
  let expirySweepTimer: NodeJS.Timeout | null = null;
  let metricsTimer: NodeJS.Timeout | null = null;

  const scheduleDispatch = (delayMs: number) => {
    if (stopped) return;
    if (dispatchTimer) return;

    dispatchTimer = setTimeout(() => {
      dispatchTimer = null;
      void dispatchLoop();
    }, delayMs);
    if (unrefTimers) {
      dispatchTimer.unref();
    }
  };

  const logQueueMetrics = async () => {
    try {
      const metrics = await getCheckoutQueueMetrics();
      logger.info(
        {
          checkoutQueue: {
            waiting: metrics.waitingCount,
            processing: metrics.processingCount,
            oldestWaitAgeSeconds: metrics.oldestWaitingAgeSeconds,
            readyLast5m: metrics.readyCountLastFiveMinutes,
            failedLast5m: metrics.failedCountLastFiveMinutes,
            activeWorkers: activeCount,
            maxActiveWorkers: env.CHECKOUT_MAX_ACTIVE
          }
        },
        'checkout queue metrics'
      );
    } catch (err) {
      logger.error({ err }, 'failed to collect checkout queue metrics');
    }
  };

  const processQueueItem = async (queueItem: CheckoutQueueItem) => {
    if (queueItem.expiresAt <= new Date()) {
      await markQueueItemFailed({
        queueId: queueItem.id,
        reason: {
          code: 'QUEUE_TIMEOUT',
          message: 'Checkout wait time expired. Please reselect your seats and try again.'
        },
        expired: true
      });
      return;
    }

    try {
      const payload = await loadCheckoutPayloadForQueueItem(queueItem);
      const result = await executeCheckoutRequest(payload);
      await markQueueItemReady({
        queueId: queueItem.id,
        result
      });
    } catch (err) {
      const reason = classifyQueueProcessingError(err);
      if (shouldRetryQueueFailure(reason, queueItem.attemptCount)) {
        const retryAt = new Date(Date.now() + retryBackoffMs(queueItem.attemptCount));
        await requeueQueueItemForRetry({
          queueId: queueItem.id,
          reason,
          retryAt
        });
        logger.warn(
          {
            queueId: queueItem.id,
            attemptCount: queueItem.attemptCount,
            retryAt,
            reasonCode: reason.code,
            reasonMessage: reason.message
          },
          'retrying checkout queue item after transient failure'
        );
        return;
      }

      const finalReason =
        reason.code === 'PAYMENT_PROVIDER_TEMPORARY_ERROR' || reason.code === 'NETWORK_RETRYABLE_ERROR'
          ? {
              ...reason,
              message: 'Checkout could not be prepared in time. Please try again.'
            }
          : reason;

      await markQueueItemFailed({
        queueId: queueItem.id,
        reason: finalReason,
        expired: finalReason.code === 'HOLD_EXPIRED'
      });
      logger.error(
        {
          err,
          queueId: queueItem.id,
          attemptCount: queueItem.attemptCount,
          reasonCode: finalReason.code,
          reasonMessage: finalReason.message
        },
        'checkout queue item failed'
      );
    }
  };

  const dispatchLoop = async () => {
    if (stopped) return;

    try {
      while (!stopped && activeCount < env.CHECKOUT_MAX_ACTIVE) {
        const queueItem = await claimNextCheckoutQueueItem();
        if (!queueItem) {
          break;
        }

        activeCount += 1;
        void processQueueItem(queueItem)
          .catch((err) => {
            logger.error({ err, queueId: queueItem.id }, 'unexpected checkout queue processing error');
          })
          .finally(() => {
            activeCount = Math.max(0, activeCount - 1);
            scheduleDispatch(0);
          });
      }
    } catch (err) {
      logger.error({ err }, 'checkout queue dispatch loop failed');
    } finally {
      scheduleDispatch(DISPATCH_TICK_MS);
    }
  };

  void recoverStaleProcessingQueueItems(STALE_PROCESSING_MAX_AGE_MS)
    .then((count) => {
      if (count > 0) {
        logger.warn({ recoveredItems: count }, 'recovered stale processing checkout queue items on boot');
      }
    })
    .catch((err) => {
      logger.error({ err }, 'failed to recover stale checkout queue items on boot');
    })
    .finally(() => {
      scheduleDispatch(0);
    });

  expirySweepTimer = setInterval(() => {
    void expireTimedOutQueueItems().catch((err) => {
      logger.error({ err }, 'failed to expire timed out checkout queue items');
    });
  }, EXPIRY_SWEEP_INTERVAL_MS);
  if (unrefTimers) {
    expirySweepTimer.unref();
  }

  metricsTimer = setInterval(() => {
    void logQueueMetrics();
  }, METRICS_LOG_INTERVAL_MS);
  if (unrefTimers) {
    metricsTimer.unref();
  }

  return {
    stop: async () => {
      stopped = true;

      if (dispatchTimer) {
        clearTimeout(dispatchTimer);
        dispatchTimer = null;
      }

      if (expirySweepTimer) {
        clearInterval(expirySweepTimer);
        expirySweepTimer = null;
      }

      if (metricsTimer) {
        clearInterval(metricsTimer);
        metricsTimer = null;
      }

      while (activeCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  };
}
