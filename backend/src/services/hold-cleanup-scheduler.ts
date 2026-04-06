import type { FastifyBaseLogger } from 'fastify';
import { env } from '../lib/env.js';
import { releaseExpiredHoldsWithAdvisoryLock } from './hold-service.js';

const HOLD_CLEANUP_ADVISORY_LOCK_KEY = 7_041_000_001n;

export type HoldCleanupSchedulerController = {
  stop: () => void;
};

export type StartHoldCleanupSchedulerOptions = {
  unrefTimer?: boolean;
};

export function startHoldCleanupScheduler(
  logger: FastifyBaseLogger,
  options: StartHoldCleanupSchedulerOptions = {}
): HoldCleanupSchedulerController {
  const unrefTimer = options.unrefTimer ?? true;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const runTick = async () => {
    if (stopped) {
      return;
    }

    try {
      const result = await releaseExpiredHoldsWithAdvisoryLock(HOLD_CLEANUP_ADVISORY_LOCK_KEY);
      if (result.lockAcquired && result.releasedCount > 0) {
        logger.info({ releasedCount: result.releasedCount }, 'released expired hold sessions');
      }
    } catch (err) {
      logger.error({ err }, 'hold cleanup scheduler tick failed');
    }
  };

  const cleanupIntervalMs = env.HOLD_CLEANUP_INTERVAL_SECONDS * 1000;
  timer = setInterval(() => {
    void runTick();
  }, cleanupIntervalMs);
  if (unrefTimer) {
    timer.unref();
  }

  void runTick();

  logger.info(
    {
      holdCleanupIntervalSeconds: env.HOLD_CLEANUP_INTERVAL_SECONDS
    },
    'hold cleanup scheduler started'
  );

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}
