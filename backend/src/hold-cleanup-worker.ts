import './lib/load-env.js';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { startHoldCleanupScheduler } from './services/hold-cleanup-scheduler.js';

export async function startHoldCleanupWorker(): Promise<void> {
  const app = Fastify({
    logger: env.NODE_ENV === 'development'
  });
  const scheduler = startHoldCleanupScheduler(app.log);
  app.log.info('hold cleanup worker process started');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    scheduler.stop();
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
  void startHoldCleanupWorker().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
