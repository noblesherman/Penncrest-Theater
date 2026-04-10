import type { FastifyBaseLogger } from 'fastify';
import os from 'node:os';
import { env } from '../lib/env.js';
import { sendSystemAlertEmail } from '../lib/email.js';
import { prisma } from '../lib/prisma.js';
import { getCheckoutQueueMetrics } from './checkout-queue-service.js';

export type HealthAlertMonitorController = {
  stop: () => void;
};

export type StartHealthAlertMonitorOptions = {
  unrefTimer?: boolean;
};

type HealthSnapshot = {
  observedAtIso: string;
  cpuPercent: number;
  memoryUsageMb: number;
  databaseLatencyMs: number;
  queueWaitingCount: number;
  queueProcessingCount: number;
  queueLagSeconds: number;
  errorsLastMinute: number;
  lastSuccessfulCheckoutSecondsAgo: number | null;
};

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,\s;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getCpuPercent(): number {
  const loadAverage1m = os.loadavg()[0] || 0;
  const cpuCount = Math.max(1, os.cpus().length);
  return Math.max(0, Math.round((loadAverage1m / cpuCount) * 100));
}

function evaluateSnapshot(snapshot: HealthSnapshot): string[] {
  const violations: string[] = [];

  if (snapshot.cpuPercent >= env.HEALTH_ALERT_CPU_PERCENT_THRESHOLD) {
    violations.push(
      `CPU ${snapshot.cpuPercent}% exceeds threshold ${env.HEALTH_ALERT_CPU_PERCENT_THRESHOLD}%`
    );
  }

  if (snapshot.memoryUsageMb >= env.HEALTH_ALERT_MEMORY_MB_THRESHOLD) {
    violations.push(
      `Memory RSS ${snapshot.memoryUsageMb}MB exceeds threshold ${env.HEALTH_ALERT_MEMORY_MB_THRESHOLD}MB`
    );
  }

  if (snapshot.databaseLatencyMs >= env.HEALTH_ALERT_DATABASE_LATENCY_MS_THRESHOLD) {
    violations.push(
      `Database latency ${snapshot.databaseLatencyMs}ms exceeds threshold ${env.HEALTH_ALERT_DATABASE_LATENCY_MS_THRESHOLD}ms`
    );
  }

  if (snapshot.queueWaitingCount >= env.HEALTH_ALERT_QUEUE_WAITING_THRESHOLD) {
    violations.push(
      `Queue waiting ${snapshot.queueWaitingCount} exceeds threshold ${env.HEALTH_ALERT_QUEUE_WAITING_THRESHOLD}`
    );
  }

  if (snapshot.queueLagSeconds >= env.HEALTH_ALERT_QUEUE_LAG_SECONDS_THRESHOLD) {
    violations.push(
      `Queue lag ${snapshot.queueLagSeconds}s exceeds threshold ${env.HEALTH_ALERT_QUEUE_LAG_SECONDS_THRESHOLD}s`
    );
  }

  if (snapshot.errorsLastMinute >= env.HEALTH_ALERT_ERRORS_LAST_MINUTE_THRESHOLD) {
    violations.push(
      `Errors last minute ${snapshot.errorsLastMinute} exceeds threshold ${env.HEALTH_ALERT_ERRORS_LAST_MINUTE_THRESHOLD}`
    );
  }

  const hasQueuePressure = snapshot.queueWaitingCount > 0 || snapshot.queueProcessingCount > 0;
  if (
    hasQueuePressure &&
    snapshot.lastSuccessfulCheckoutSecondsAgo !== null &&
    snapshot.lastSuccessfulCheckoutSecondsAgo >= env.HEALTH_ALERT_CHECKOUT_STALE_SECONDS_THRESHOLD
  ) {
    violations.push(
      `No successful checkout for ${snapshot.lastSuccessfulCheckoutSecondsAgo}s while queue is active (threshold ${env.HEALTH_ALERT_CHECKOUT_STALE_SECONDS_THRESHOLD}s)`
    );
  }

  return violations;
}

function formatAlertText(violations: string[], snapshot: HealthSnapshot): string {
  const violationLines = violations.map((violation, index) => `${index + 1}. ${violation}`).join('\n');
  const metrics = [
    `observedAt: ${snapshot.observedAtIso}`,
    `cpuPercent: ${snapshot.cpuPercent}`,
    `memoryUsageMb: ${snapshot.memoryUsageMb}`,
    `databaseLatencyMs: ${snapshot.databaseLatencyMs}`,
    `queueWaitingCount: ${snapshot.queueWaitingCount}`,
    `queueProcessingCount: ${snapshot.queueProcessingCount}`,
    `queueLagSeconds: ${snapshot.queueLagSeconds}`,
    `errorsLastMinute: ${snapshot.errorsLastMinute}`,
    `lastSuccessfulCheckoutSecondsAgo: ${snapshot.lastSuccessfulCheckoutSecondsAgo ?? 'null'}`
  ].join('\n');

  return [
    'Penncrest Theater backend overload alert.',
    '',
    'Triggered conditions:',
    violationLines,
    '',
    'Snapshot:',
    metrics
  ].join('\n');
}

export function startHealthAlertMonitor(
  logger: FastifyBaseLogger,
  options: StartHealthAlertMonitorOptions = {}
): HealthAlertMonitorController {
  const recipients = parseRecipients(env.HEALTH_ALERT_EMAIL_TO);
  if (recipients.length === 0) {
    logger.warn('health alert monitor disabled because HEALTH_ALERT_EMAIL_TO is empty');
    return {
      stop: () => undefined
    };
  }

  const unrefTimer = options.unrefTimer ?? true;
  const cooldownMs = env.HEALTH_ALERT_COOLDOWN_MINUTES * 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let lastAlertSentAtMs: number | null = null;
  let lastStateWasOverloaded = false;

  const runTick = async () => {
    if (stopped) return;

    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60_000);
    try {
      const dbStartedAt = process.hrtime.bigint();
      await prisma.$queryRaw`SELECT 1`;
      const databaseLatencyMs = Number((process.hrtime.bigint() - dbStartedAt) / 1_000_000n);

      const [queueMetrics, queueErrorsLastMinute, finalizationFailedLastMinute, webhooksFailedLastMinute, lastPaidOrder] =
        await Promise.all([
          getCheckoutQueueMetrics(now),
          prisma.checkoutQueueItem.count({
            where: {
              status: { in: ['FAILED', 'EXPIRED'] },
              updatedAt: { gte: minuteAgo }
            }
          }),
          prisma.order.count({
            where: {
              status: 'FINALIZATION_FAILED',
              updatedAt: { gte: minuteAgo }
            }
          }),
          prisma.stripeWebhookEvent.count({
            where: {
              status: 'FAILED',
              updatedAt: { gte: minuteAgo }
            }
          }),
          prisma.order.findFirst({
            where: { status: 'PAID' },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true }
          })
        ]);

      const errorsLastMinute = queueErrorsLastMinute + finalizationFailedLastMinute + webhooksFailedLastMinute;
      const lastSuccessfulCheckoutSecondsAgo = lastPaidOrder
        ? Math.max(0, Math.floor((now.getTime() - lastPaidOrder.updatedAt.getTime()) / 1000))
        : null;

      const snapshot: HealthSnapshot = {
        observedAtIso: now.toISOString(),
        cpuPercent: getCpuPercent(),
        memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        databaseLatencyMs,
        queueWaitingCount: queueMetrics.waitingCount,
        queueProcessingCount: queueMetrics.processingCount,
        queueLagSeconds: queueMetrics.oldestWaitingAgeSeconds,
        errorsLastMinute,
        lastSuccessfulCheckoutSecondsAgo
      };

      const violations = evaluateSnapshot(snapshot);
      const overloaded = violations.length > 0;

      if (overloaded) {
        const nowMs = Date.now();
        const shouldSend = !lastAlertSentAtMs || nowMs - lastAlertSentAtMs >= cooldownMs;
        if (shouldSend) {
          const subject = `[ALERT] Penncrest Theater load warning (${violations.length} trigger${violations.length === 1 ? '' : 's'})`;
          const text = formatAlertText(violations, snapshot);
          const html = `<pre style="font-family:Menlo,Consolas,monospace;white-space:pre-wrap;">${text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</pre>`;
          await sendSystemAlertEmail({
            to: recipients,
            subject,
            text,
            html
          });
          lastAlertSentAtMs = nowMs;
          logger.error(
            {
              violations,
              snapshot,
              recipients
            },
            'health alert email sent'
          );
        } else {
          logger.warn(
            {
              violations,
              snapshot,
              cooldownMinutes: env.HEALTH_ALERT_COOLDOWN_MINUTES
            },
            'health alert suppressed due to cooldown'
          );
        }
      } else if (lastStateWasOverloaded && env.HEALTH_ALERT_SEND_RECOVERY_EMAIL) {
        const subject = '[RECOVERY] Penncrest Theater load normalized';
        const text = [
          'Penncrest Theater backend appears to have recovered.',
          '',
          'Latest snapshot:',
          `observedAt: ${snapshot.observedAtIso}`,
          `cpuPercent: ${snapshot.cpuPercent}`,
          `memoryUsageMb: ${snapshot.memoryUsageMb}`,
          `databaseLatencyMs: ${snapshot.databaseLatencyMs}`,
          `queueWaitingCount: ${snapshot.queueWaitingCount}`,
          `queueProcessingCount: ${snapshot.queueProcessingCount}`,
          `queueLagSeconds: ${snapshot.queueLagSeconds}`,
          `errorsLastMinute: ${snapshot.errorsLastMinute}`,
          `lastSuccessfulCheckoutSecondsAgo: ${snapshot.lastSuccessfulCheckoutSecondsAgo ?? 'null'}`
        ].join('\n');
        await sendSystemAlertEmail({
          to: recipients,
          subject,
          text,
          html: `<pre style="font-family:Menlo,Consolas,monospace;white-space:pre-wrap;">${text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</pre>`
        });
        logger.info({ snapshot, recipients }, 'health recovery email sent');
      }

      lastStateWasOverloaded = overloaded;
    } catch (err) {
      logger.error({ err }, 'health alert monitor tick failed');
    }
  };

  const checkIntervalMs = env.HEALTH_ALERT_CHECK_INTERVAL_SECONDS * 1000;
  timer = setInterval(() => {
    void runTick();
  }, checkIntervalMs);
  if (unrefTimer) timer.unref();

  void runTick();
  logger.info(
    {
      recipients,
      checkIntervalSeconds: env.HEALTH_ALERT_CHECK_INTERVAL_SECONDS,
      cooldownMinutes: env.HEALTH_ALERT_COOLDOWN_MINUTES
    },
    'health alert monitor started'
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
