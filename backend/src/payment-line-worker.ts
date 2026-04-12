import './lib/load-env.js';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { startPaymentLineWorker } from './services/payment-line-worker.js';

export async function startDedicatedPaymentLineWorker(): Promise<void> {
  const app = Fastify({
    logger: env.NODE_ENV === 'development'
  });

  const worker = startPaymentLineWorker(app.log, { unrefTimers: false });

  app.log.info(
    {
      activeTimeoutSeconds: env.PAYMENT_LINE_ACTIVE_TIMEOUT_SECONDS,
      sweepIntervalSeconds: env.PAYMENT_LINE_WORKER_SWEEP_INTERVAL_SECONDS
    },
    'payment line worker process started'
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
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
  void startDedicatedPaymentLineWorker().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
