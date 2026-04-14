import './lib/load-env.js';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { startTicketEmailOutboxWorker } from './services/ticket-email-outbox-worker.js';

export async function startDedicatedTicketEmailOutboxWorker(): Promise<void> {
  const app = Fastify({
    logger: env.NODE_ENV === 'development'
  });
  const worker = startTicketEmailOutboxWorker(app.log, { unrefTimers: false });

  app.log.info(
    {
      sweepIntervalSeconds: env.TICKET_EMAIL_OUTBOX_WORKER_SWEEP_INTERVAL_SECONDS,
      maxAttempts: env.TICKET_EMAIL_OUTBOX_MAX_ATTEMPTS,
      batchSize: env.TICKET_EMAIL_OUTBOX_BATCH_SIZE
    },
    'ticket email outbox worker process started'
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    await worker.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

const entryFile = process.argv[1];
if (entryFile && fileURLToPath(import.meta.url) === entryFile) {
  void startDedicatedTicketEmailOutboxWorker().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
