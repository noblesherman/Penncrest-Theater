/*
Handoff note for Mr. Smith:
- File: `backend/src/ticket-email-outbox-worker.ts`
- What this is: Backend runtime entry/worker bootstrap.
- What it does: Starts a process and wires env, plugins, routes, or background loops.
- Connections: Connects core infrastructure pieces at process startup.
- Main content type: Startup orchestration.
- Safe edits here: Startup comments and non-functional notes.
- Be careful with: Initialization order and env assumptions.
- Useful context: If a process crashes before serving work, this is the first place to inspect.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
