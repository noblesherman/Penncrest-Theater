import type { FastifyBaseLogger } from 'fastify';
import { env } from '../lib/env.js';
import {
  extendWaitingPaymentLineHolds,
  expireTimedOutActivePaymentLineEntries,
  fetchPaymentLineSnapshot,
  publishActiveTimeout,
  publishNowServingChanged,
  publishQueueAndEntry,
  publishQueueSnapshot
} from './payment-line-service.js';

export type PaymentLineWorkerController = {
  stop: () => Promise<void>;
};

export type StartPaymentLineWorkerOptions = {
  unrefTimers?: boolean;
};

export function startPaymentLineWorker(
  logger: FastifyBaseLogger,
  options: StartPaymentLineWorkerOptions = {}
): PaymentLineWorkerController {
  const sweepIntervalMs = env.PAYMENT_LINE_WORKER_SWEEP_INTERVAL_SECONDS * 1_000;
  const unrefTimers = options.unrefTimers ?? true;
  let stopped = false;
  let running = false;

  const runSweep = async () => {
    if (stopped || running) {
      return;
    }

    running = true;
    try {
      const timedOut = await expireTimedOutActivePaymentLineEntries(100);
      for (const entry of timedOut) {
        await publishActiveTimeout(entry.queueKey, entry.entryId);
        await publishQueueAndEntry(entry.queueKey, entry.entryId);
        const snapshot = await fetchPaymentLineSnapshot(entry.queueKey);
        await publishNowServingChanged(entry.queueKey, snapshot.nowServingEntryId);
      }

      const extended = await extendWaitingPaymentLineHolds(250);
      for (const queueKey of extended.touchedQueueKeys) {
        await publishQueueSnapshot(queueKey);
      }

      if (timedOut.length > 0 || extended.extendedCount > 0 || extended.failedEntryIds.length > 0) {
        logger.info(
          {
            paymentLineWorker: {
              timedOutActiveCount: timedOut.length,
              extendedWaitingHoldCount: extended.extendedCount,
              failedHoldExtensionCount: extended.failedEntryIds.length
            }
          },
          'payment line worker sweep completed'
        );
      }
    } catch (err) {
      logger.error({ err }, 'payment line worker sweep failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runSweep();
  }, sweepIntervalMs);

  if (unrefTimers) {
    timer.unref();
  }

  void runSweep();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);

      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  };
}
