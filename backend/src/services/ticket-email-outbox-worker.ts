/*
Handoff note for Mr. Smith:
- File: `backend/src/services/ticket-email-outbox-worker.ts`
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
import type { Prisma } from '@prisma/client';
import { env } from '../lib/env.js';
import { sendTicketsEmail, type TicketEmailPayload } from '../lib/email.js';
import {
  claimNextTicketEmailOutbox,
  markTicketEmailOutboxFailed,
  markTicketEmailOutboxSent,
  recoverStaleTicketEmailOutboxJobs
} from './ticket-email-outbox-service.js';

export type TicketEmailOutboxWorkerController = {
  stop: () => Promise<void>;
};

export type StartTicketEmailOutboxWorkerOptions = {
  unrefTimers?: boolean;
};

function asTicketEmailPayload(payloadJson: Prisma.JsonValue): TicketEmailPayload {
  return payloadJson as unknown as TicketEmailPayload;
}

export function startTicketEmailOutboxWorker(
  logger: FastifyBaseLogger,
  options: StartTicketEmailOutboxWorkerOptions = {}
): TicketEmailOutboxWorkerController {
  const sweepIntervalMs = env.TICKET_EMAIL_OUTBOX_WORKER_SWEEP_INTERVAL_SECONDS * 1000;
  const batchSize = env.TICKET_EMAIL_OUTBOX_BATCH_SIZE;
  const unrefTimers = options.unrefTimers ?? true;
  let stopped = false;
  let running = false;

  const runSweep = async () => {
    if (stopped || running) {
      return;
    }

    running = true;
    try {
      const recoveredCount = await recoverStaleTicketEmailOutboxJobs();
      let deliveredCount = 0;
      let failedCount = 0;

      for (let processed = 0; processed < batchSize; processed += 1) {
        const claimed = await claimNextTicketEmailOutbox();
        if (!claimed) {
          break;
        }

        try {
          const payload = asTicketEmailPayload(claimed.payloadJson);
          await sendTicketsEmail(payload);
          await markTicketEmailOutboxSent(claimed.id);
          deliveredCount += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown ticket email send failure';
          await markTicketEmailOutboxFailed({
            id: claimed.id,
            attemptCount: claimed.attemptCount,
            errorMessage: message
          });
          failedCount += 1;
          logger.error(
            {
              err,
              outboxId: claimed.id,
              orderId: claimed.orderId,
              attemptCount: claimed.attemptCount
            },
            'ticket email outbox delivery failed'
          );
        }
      }

      if (recoveredCount > 0 || deliveredCount > 0 || failedCount > 0) {
        logger.info(
          {
            ticketEmailOutboxWorker: {
              recoveredCount,
              deliveredCount,
              failedCount,
              batchSize
            }
          },
          'ticket email outbox worker sweep completed'
        );
      }
    } catch (err) {
      logger.error({ err }, 'ticket email outbox worker sweep failed');
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
