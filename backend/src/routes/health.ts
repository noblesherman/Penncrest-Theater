/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/health.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FastifyPluginAsync } from 'fastify';
import os from 'node:os';
import { prisma } from '../lib/prisma.js';
import { env, getR2Config, isSmtpConfigured } from '../lib/env.js';
import { getCheckoutQueueMetrics } from '../services/checkout-queue-service.js';

const DEGRADED_QUEUE_LAG_SECONDS = 10;
const DEGRADED_DATABASE_LATENCY_MS = 750;
const STUCK_PROCESSING_THRESHOLD_SECONDS = 120;
const HEALTH_DIAGNOSTICS_CACHE_TTL_MS = env.HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS * 1000;

type QueueStatusCounts = Record<'WAITING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED' | 'CANCELED', number>;
type OrderStatusCounts = Record<'PENDING' | 'PAID' | 'FINALIZATION_FAILED' | 'REFUNDED' | 'CANCELED', number>;
type HoldStatusCounts = Record<'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'CANCELED', number>;
type SeatStatusCounts = Record<'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED', number>;
type WebhookStatusCounts = Record<'PROCESSING' | 'PROCESSED' | 'FAILED', number>;

type HealthDependencyConfigSnapshot = {
  r2Config: ReturnType<typeof getR2Config>;
  stripeStatus: 'configured' | 'missing';
  stripeMode: 'live' | 'test' | 'unknown';
  emailStatus: 'configured' | 'not_configured';
  googleOauthStatus: 'configured' | 'missing';
  microsoftOauthStatus: 'configured' | 'missing';
};

type HealthDiagnosticsMetricsSnapshot = Awaited<ReturnType<typeof queryHealthDiagnosticsMetrics>>;

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function elapsedMs(start: bigint): number {
  return Number((process.hrtime.bigint() - start) / 1_000_000n);
}

function getSystemSnapshot(): {
  memoryUsageMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMemoryMb: number;
  freeMemoryMb: number;
  totalMemoryMb: number;
  cpuPercent: number;
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
} {
  const memory = process.memoryUsage();
  const [loadAverage1m, loadAverage5m, loadAverage15m] = os.loadavg();
  const cpuCount = Math.max(1, os.cpus().length);
  const cpuPercent = Math.max(0, Math.round((loadAverage1m / cpuCount) * 100));

  return {
    memoryUsageMb: Math.round(memory.rss / (1024 * 1024)),
    heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
    externalMemoryMb: Math.round(memory.external / (1024 * 1024)),
    freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    cpuPercent,
    loadAverage1m: roundTo(loadAverage1m, 2),
    loadAverage5m: roundTo(loadAverage5m, 2),
    loadAverage15m: roundTo(loadAverage15m, 2)
  };
}

function isOauthConfigured(clientId?: string, clientSecret?: string, redirectUri?: string): boolean {
  return Boolean(clientId && clientSecret && redirectUri);
}

function getDependencyConfigSnapshot(): HealthDependencyConfigSnapshot {
  const r2Config = getR2Config();
  const stripeStatus = env.STRIPE_SECRET_KEY.startsWith('sk_') ? 'configured' : 'missing';
  const stripeMode = env.STRIPE_SECRET_KEY.startsWith('sk_live_')
    ? 'live'
    : env.STRIPE_SECRET_KEY.startsWith('sk_test_')
      ? 'test'
      : 'unknown';
  const emailStatus = isSmtpConfigured() ? 'configured' : 'not_configured';
  const googleOauthStatus = isOauthConfigured(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI
  )
    ? 'configured'
    : 'missing';
  const microsoftOauthStatus = isOauthConfigured(
    env.MICROSOFT_OAUTH_CLIENT_ID,
    env.MICROSOFT_OAUTH_CLIENT_SECRET,
    env.MICROSOFT_OAUTH_REDIRECT_URI
  )
    ? 'configured'
    : 'missing';

  return {
    r2Config,
    stripeStatus,
    stripeMode,
    emailStatus,
    googleOauthStatus,
    microsoftOauthStatus
  };
}

async function queryHealthDiagnosticsMetrics(now: Date) {
  const minuteAgo = new Date(now.getTime() - 60_000);
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const holdExpiringSoonAt = new Date(now.getTime() + 2 * 60_000);
  const staleProcessingThreshold = new Date(now.getTime() - STUCK_PROCESSING_THRESHOLD_SECONDS * 1000);

  const [
    schemaCheck,
    queueMetrics,
    queueStatusRows,
    orderStatusRows,
    holdStatusRows,
    seatStatusRows,
    webhookStatusRows,
    queueErrorsLastMinute,
    finalizationFailedLastMinute,
    successfulCheckoutsLastMinute,
    successfulCheckoutsLastFiveMinutes,
    successfulCheckoutsLastFifteenMinutes,
    paidLast24Hours,
    refundedLast24Hours,
    finalizationFailedLast24Hours,
    activeHoldSessions,
    holdsExpiringWithinTwoMinutes,
    staleActiveHoldSessions,
    stuckProcessingCount,
    retryScheduledCount,
    retryReadyCount,
    webhooksFailedLastMinute,
    webhooksProcessedLastFiveMinutes,
    lastSuccessfulCheckout
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{ accessTokenColumn: boolean; stripeRefundIdColumn: boolean; finalizationFailedEnum: boolean }>
    >`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'Order'
            AND column_name = 'accessToken'
        ) AS "accessTokenColumn",
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'Order'
            AND column_name = 'stripeRefundId'
        ) AS "stripeRefundIdColumn",
        EXISTS (
          SELECT 1
          FROM pg_enum enum
          JOIN pg_type type ON type.oid = enum.enumtypid
          WHERE type.typname = 'OrderStatus'
            AND enum.enumlabel = 'FINALIZATION_FAILED'
        ) AS "finalizationFailedEnum"
    `,
    getCheckoutQueueMetrics(now),
    prisma.checkoutQueueItem.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.order.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.holdSession.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.seat.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.stripeWebhookEvent.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: {
          in: ['FAILED', 'EXPIRED']
        },
        updatedAt: {
          gte: minuteAgo
        }
      }
    }),
    prisma.order.count({
      where: {
        status: 'FINALIZATION_FAILED',
        updatedAt: { gte: minuteAgo }
      }
    }),
    prisma.order.count({
      where: {
        status: 'PAID',
        updatedAt: { gte: minuteAgo }
      }
    }),
    prisma.order.count({
      where: {
        status: 'PAID',
        updatedAt: { gte: fiveMinutesAgo }
      }
    }),
    prisma.order.count({
      where: {
        status: 'PAID',
        updatedAt: { gte: fifteenMinutesAgo }
      }
    }),
    prisma.order.count({
      where: {
        status: 'PAID',
        updatedAt: { gte: twentyFourHoursAgo }
      }
    }),
    prisma.order.count({
      where: {
        status: 'REFUNDED',
        updatedAt: { gte: twentyFourHoursAgo }
      }
    }),
    prisma.order.count({
      where: {
        status: 'FINALIZATION_FAILED',
        updatedAt: { gte: twentyFourHoursAgo }
      }
    }),
    prisma.holdSession.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: now }
      }
    }),
    prisma.holdSession.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: now, lte: holdExpiringSoonAt }
      }
    }),
    prisma.holdSession.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now }
      }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: 'PROCESSING',
        processingStartedAt: { lt: staleProcessingThreshold }
      }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: 'WAITING',
        nextAttemptAt: { gt: now },
        expiresAt: { gt: now }
      }
    }),
    prisma.checkoutQueueItem.count({
      where: {
        status: 'WAITING',
        expiresAt: { gt: now },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      }
    }),
    prisma.stripeWebhookEvent.count({
      where: {
        status: 'FAILED',
        updatedAt: { gte: minuteAgo }
      }
    }),
    prisma.stripeWebhookEvent.count({
      where: {
        status: 'PROCESSED',
        updatedAt: { gte: fiveMinutesAgo }
      }
    }),
    prisma.order.findFirst({
      where: { status: 'PAID' },
      orderBy: { updatedAt: 'desc' },
      select: {
        updatedAt: true,
        amountTotal: true,
        currency: true,
        source: true
      }
    })
  ]);

  return {
    queriedAt: now.toISOString(),
    schemaCheck,
    queueMetrics,
    queueStatusRows,
    orderStatusRows,
    holdStatusRows,
    seatStatusRows,
    webhookStatusRows,
    queueErrorsLastMinute,
    finalizationFailedLastMinute,
    successfulCheckoutsLastMinute,
    successfulCheckoutsLastFiveMinutes,
    successfulCheckoutsLastFifteenMinutes,
    paidLast24Hours,
    refundedLast24Hours,
    finalizationFailedLast24Hours,
    activeHoldSessions,
    holdsExpiringWithinTwoMinutes,
    staleActiveHoldSessions,
    stuckProcessingCount,
    retryScheduledCount,
    retryReadyCount,
    webhooksFailedLastMinute,
    webhooksProcessedLastFiveMinutes,
    lastSuccessfulCheckout
  };
}

let healthDiagnosticsCache: { cachedAtMs: number; snapshot: HealthDiagnosticsMetricsSnapshot } | null = null;
let healthDiagnosticsInFlight: Promise<HealthDiagnosticsMetricsSnapshot> | null = null;

async function getHealthDiagnosticsMetrics(now: Date): Promise<{
  snapshot: HealthDiagnosticsMetricsSnapshot;
  cacheAgeSeconds: number;
  fromCache: boolean;
}> {
  const cached = healthDiagnosticsCache;
  if (cached) {
    const ageMs = Date.now() - cached.cachedAtMs;
    if (ageMs < HEALTH_DIAGNOSTICS_CACHE_TTL_MS) {
      return {
        snapshot: cached.snapshot,
        cacheAgeSeconds: roundTo(ageMs / 1000, 3),
        fromCache: true
      };
    }
  }

  if (healthDiagnosticsInFlight) {
    const snapshot = await healthDiagnosticsInFlight;
    const latestCache = healthDiagnosticsCache;
    const ageMs = latestCache ? Date.now() - latestCache.cachedAtMs : 0;
    return {
      snapshot,
      cacheAgeSeconds: roundTo(Math.max(0, ageMs) / 1000, 3),
      fromCache: true
    };
  }

  healthDiagnosticsInFlight = queryHealthDiagnosticsMetrics(now);
  try {
    const snapshot = await healthDiagnosticsInFlight;
    healthDiagnosticsCache = {
      cachedAtMs: Date.now(),
      snapshot
    };
    return {
      snapshot,
      cacheAgeSeconds: 0,
      fromCache: false
    };
  } finally {
    healthDiagnosticsInFlight = null;
  }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/health/ready', async (_request, reply) => {
    const requestStartedAt = process.hrtime.bigint();
    const now = new Date();
    const { r2Config, stripeStatus, stripeMode, emailStatus, googleOauthStatus, microsoftOauthStatus } =
      getDependencyConfigSnapshot();

    try {
      const databasePingStartedAt = process.hrtime.bigint();
      const dbHeartbeat = await prisma.$queryRaw<Array<{ databaseNow: Date; databaseName: string }>>`
        SELECT NOW() AS "databaseNow", current_database() AS "databaseName"
      `;
      const databaseLatencyMs = elapsedMs(databasePingStartedAt);
      const dbNow = dbHeartbeat[0]?.databaseNow ? new Date(dbHeartbeat[0].databaseNow) : now;
      const databaseClockSkewMs = Math.abs(now.getTime() - dbNow.getTime());
      const databaseName = dbHeartbeat[0]?.databaseName || 'unknown';
      const degradationReasons =
        databaseLatencyMs >= DEGRADED_DATABASE_LATENCY_MS ? ['database_latency_high'] : ([] as string[]);

      return {
        status: degradationReasons.length > 0 ? 'degraded' : 'ok',
        observedAt: now.toISOString(),
        responseTimeMs: elapsedMs(requestStartedAt),
        degradationReasons,
        service: {
          environment: env.NODE_ENV,
          uptimeSeconds: Math.floor(process.uptime()),
          startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        dependencies: {
          database: {
            status: 'ok',
            latencyMs: databaseLatencyMs,
            schemaReady: null,
            clockSkewMs: databaseClockSkewMs,
            name: databaseName
          },
          stripe: {
            status: stripeStatus,
            mode: stripeMode,
            publishableKeyConfigured: Boolean(env.STRIPE_PUBLISHABLE_KEY),
            webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET)
          },
          email: {
            status: emailStatus,
            transport: env.SMTP_HOST ? 'smtp' : 'not_configured'
          },
          storage: {
            status: r2Config ? 'configured' : 'not_configured',
            provider: 'cloudflare_r2',
            maxUploadBytes: r2Config?.maxUploadBytes ?? null
          },
          oauth: {
            google: googleOauthStatus,
            microsoft: microsoftOauthStatus
          }
        },
        system: getSystemSnapshot(),
        diagnostics: {
          path: '/health/diag',
          cacheTtlSeconds: env.HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS
        }
      };
    } catch (err) {
      app.log.error({ err }, 'Health readiness check failed');
      return reply.status(503).send({
        status: 'degraded',
        observedAt: now.toISOString(),
        responseTimeMs: elapsedMs(requestStartedAt),
        degradationReasons: ['dependency_probe_failed'],
        dependencies: {
          database: {
            status: 'unavailable',
            latencyMs: null,
            schemaReady: null,
            clockSkewMs: null,
            name: null
          },
          stripe: {
            status: stripeStatus,
            mode: stripeMode,
            publishableKeyConfigured: Boolean(env.STRIPE_PUBLISHABLE_KEY),
            webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET)
          },
          email: {
            status: emailStatus,
            transport: env.SMTP_HOST ? 'smtp' : 'not_configured'
          },
          storage: {
            status: r2Config ? 'configured' : 'not_configured',
            provider: 'cloudflare_r2',
            maxUploadBytes: r2Config?.maxUploadBytes ?? null
          },
          oauth: {
            google: googleOauthStatus,
            microsoft: microsoftOauthStatus
          }
        },
        system: getSystemSnapshot(),
        diagnostics: {
          path: '/health/diag',
          cacheTtlSeconds: env.HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS
        }
      });
    }
  });

  app.get(
    '/api/health/diagnostics',
    { preHandler: app.authenticateAdmin },
    async (_request, reply) => reply.redirect('/health/diag', 307)
  );

  app.get('/health/diag', { preHandler: app.authenticateAdmin }, async (_request, reply) => {
    const requestStartedAt = process.hrtime.bigint();
    const now = new Date();
    const { r2Config, stripeStatus, stripeMode, emailStatus, googleOauthStatus, microsoftOauthStatus } =
      getDependencyConfigSnapshot();

    try {
      const databasePingStartedAt = process.hrtime.bigint();
      const dbHeartbeat = await prisma.$queryRaw<Array<{ databaseNow: Date; databaseName: string }>>`
        SELECT NOW() AS "databaseNow", current_database() AS "databaseName"
      `;
      const databaseLatencyMs = elapsedMs(databasePingStartedAt);
      const dbNow = dbHeartbeat[0]?.databaseNow ? new Date(dbHeartbeat[0].databaseNow) : now;
      const databaseClockSkewMs = Math.abs(now.getTime() - dbNow.getTime());
      const databaseName = dbHeartbeat[0]?.databaseName || 'unknown';

      const diagnosticsMetrics = await getHealthDiagnosticsMetrics(now);
      const {
        queriedAt,
        schemaCheck,
        queueMetrics,
        queueStatusRows,
        orderStatusRows,
        holdStatusRows,
        seatStatusRows,
        webhookStatusRows,
        queueErrorsLastMinute,
        finalizationFailedLastMinute,
        successfulCheckoutsLastMinute,
        successfulCheckoutsLastFiveMinutes,
        successfulCheckoutsLastFifteenMinutes,
        paidLast24Hours,
        refundedLast24Hours,
        finalizationFailedLast24Hours,
        activeHoldSessions,
        holdsExpiringWithinTwoMinutes,
        staleActiveHoldSessions,
        stuckProcessingCount,
        retryScheduledCount,
        retryReadyCount,
        webhooksFailedLastMinute,
        webhooksProcessedLastFiveMinutes,
        lastSuccessfulCheckout
      } = diagnosticsMetrics.snapshot;

      const schemaReady =
        schemaCheck[0]?.accessTokenColumn &&
        schemaCheck[0]?.stripeRefundIdColumn &&
        schemaCheck[0]?.finalizationFailedEnum;

      const queueByStatus: QueueStatusCounts = {
        WAITING: 0,
        PROCESSING: 0,
        READY: 0,
        FAILED: 0,
        EXPIRED: 0,
        CANCELED: 0
      };
      for (const row of queueStatusRows) {
        queueByStatus[row.status] = row._count.status;
      }

      const ordersByStatus: OrderStatusCounts = {
        PENDING: 0,
        PAID: 0,
        FINALIZATION_FAILED: 0,
        REFUNDED: 0,
        CANCELED: 0
      };
      for (const row of orderStatusRows) {
        ordersByStatus[row.status] = row._count.status;
      }

      const holdsByStatus: HoldStatusCounts = {
        ACTIVE: 0,
        EXPIRED: 0,
        CONVERTED: 0,
        CANCELED: 0
      };
      for (const row of holdStatusRows) {
        holdsByStatus[row.status] = row._count.status;
      }

      const seatsByStatus: SeatStatusCounts = {
        AVAILABLE: 0,
        HELD: 0,
        SOLD: 0,
        BLOCKED: 0
      };
      for (const row of seatStatusRows) {
        seatsByStatus[row.status] = row._count.status;
      }

      const webhooksByStatus: WebhookStatusCounts = {
        PROCESSING: 0,
        PROCESSED: 0,
        FAILED: 0
      };
      for (const row of webhookStatusRows) {
        webhooksByStatus[row.status] = row._count.status;
      }

      const totalSeats = seatsByStatus.AVAILABLE + seatsByStatus.HELD + seatsByStatus.SOLD + seatsByStatus.BLOCKED;
      const soldPercent = totalSeats > 0 ? roundTo((seatsByStatus.SOLD / totalSeats) * 100, 1) : 0;
      const queueLagSeconds = queueMetrics.oldestWaitingAgeSeconds;
      const queueCapacityUtilizationPercent = roundTo(
        (queueMetrics.processingCount / Math.max(1, env.CHECKOUT_MAX_ACTIVE)) * 100,
        1
      );
      const lastSuccessfulCheckoutSecondsAgo = lastSuccessfulCheckout
        ? Math.max(0, Math.floor((now.getTime() - lastSuccessfulCheckout.updatedAt.getTime()) / 1000))
        : null;
      const errorsLastMinute = queueErrorsLastMinute + finalizationFailedLastMinute + webhooksFailedLastMinute;

      const degradationReasons: string[] = [];
      if (queueLagSeconds >= DEGRADED_QUEUE_LAG_SECONDS) degradationReasons.push('queue_lag_high');
      if (errorsLastMinute > 0) degradationReasons.push('recent_errors_detected');
      if (databaseLatencyMs >= DEGRADED_DATABASE_LATENCY_MS) degradationReasons.push('database_latency_high');
      if (stuckProcessingCount > 0) degradationReasons.push('stuck_processing_items');

      if (!schemaReady) {
        degradationReasons.push('database_schema_mismatch');
        app.log.error('Health check failed: database schema is missing production-hardening migration');
      }

      const status = degradationReasons.length > 0 ? 'degraded' : 'ok';
      const responseTimeMs = elapsedMs(requestStartedAt);
      const system = getSystemSnapshot();

      const payload = {
        status,
        observedAt: now.toISOString(),
        responseTimeMs,
        degradationReasons,
        service: {
          environment: env.NODE_ENV,
          uptimeSeconds: Math.floor(process.uptime()),
          startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        dependencies: {
          database: {
            status: schemaReady ? 'ok' : 'schema_mismatch',
            latencyMs: databaseLatencyMs,
            schemaReady,
            clockSkewMs: databaseClockSkewMs,
            name: databaseName
          },
          stripe: {
            status: stripeStatus,
            mode: stripeMode,
            publishableKeyConfigured: Boolean(env.STRIPE_PUBLISHABLE_KEY),
            webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET)
          },
          email: {
            status: emailStatus,
            transport: env.SMTP_HOST ? 'smtp' : 'not_configured'
          },
          storage: {
            status: r2Config ? 'configured' : 'not_configured',
            provider: 'cloudflare_r2',
            maxUploadBytes: r2Config?.maxUploadBytes ?? null
          },
          oauth: {
            google: googleOauthStatus,
            microsoft: microsoftOauthStatus
          }
        },
        queue: {
          waitingCount: queueMetrics.waitingCount,
          processingCount: queueMetrics.processingCount,
          lagSeconds: queueLagSeconds,
          oldestWaitingAgeSeconds: queueMetrics.oldestWaitingAgeSeconds,
          readyCountLastFiveMinutes: queueMetrics.readyCountLastFiveMinutes,
          failedCountLastFiveMinutes: queueMetrics.failedCountLastFiveMinutes,
          byStatus: queueByStatus,
          capacity: {
            maxActive: env.CHECKOUT_MAX_ACTIVE,
            utilizationPercent: queueCapacityUtilizationPercent,
            stuckProcessingCount
          },
          retry: {
            retryReadyCount,
            retryScheduledCount
          },
          config: {
            maxWaitSeconds: env.CHECKOUT_QUEUE_MAX_WAIT_SECONDS,
            pollMinMs: env.CHECKOUT_QUEUE_POLL_MIN_MS,
            pollMaxMs: env.CHECKOUT_QUEUE_POLL_MAX_MS
          }
        },
        throughput: {
          successfulCheckoutsLastMinute,
          successfulCheckoutsLastFiveMinutes,
          successfulCheckoutsLastFifteenMinutes,
          queueReadyLastFiveMinutes: queueMetrics.readyCountLastFiveMinutes,
          queueFailuresLastFiveMinutes: queueMetrics.failedCountLastFiveMinutes
        },
        errorsLastMinute,
        orders: {
          byStatus: ordersByStatus,
          paidLast24Hours,
          refundedLast24Hours,
          finalizationFailedLast24Hours
        },
        holds: {
          activeCount: activeHoldSessions,
          expiringWithinTwoMinutes: holdsExpiringWithinTwoMinutes,
          staleActiveCount: staleActiveHoldSessions,
          byStatus: holdsByStatus,
          config: {
            holdTtlMinutes: env.HOLD_TTL_MINUTES,
            cleanupIntervalSeconds: env.HOLD_CLEANUP_INTERVAL_SECONDS
          }
        },
        webhooks: {
          byStatus: webhooksByStatus,
          failedLastMinute: webhooksFailedLastMinute,
          processedLastFiveMinutes: webhooksProcessedLastFiveMinutes
        },
        seats: {
          total: totalSeats,
          soldPercent,
          byStatus: seatsByStatus
        },
        system,
        lastSuccessfulCheckout: lastSuccessfulCheckout
          ? {
              at: lastSuccessfulCheckout.updatedAt.toISOString(),
              secondsAgo: lastSuccessfulCheckoutSecondsAgo,
              amountCents: lastSuccessfulCheckout.amountTotal,
              currency: lastSuccessfulCheckout.currency,
              source: lastSuccessfulCheckout.source
            }
          : null,
        lastSuccessfulCheckoutSecondsAgo,
        cache: {
          diagnosticsQueriedAt: queriedAt,
          diagnosticsFromCache: diagnosticsMetrics.fromCache,
          diagnosticsAgeSeconds: diagnosticsMetrics.cacheAgeSeconds,
          diagnosticsTtlSeconds: env.HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS
        }
      };

      if (!schemaReady) {
        return reply.status(503).send(payload);
      }

      return payload;
    } catch (err) {
      app.log.error({ err }, 'Health check failed');
      return reply.status(503).send({
        status: 'degraded',
        observedAt: now.toISOString(),
        responseTimeMs: elapsedMs(requestStartedAt),
        degradationReasons: ['dependency_probe_failed'],
        dependencies: {
          database: {
            status: 'unavailable',
            latencyMs: null,
            schemaReady: null,
            clockSkewMs: null,
            name: null
          },
          stripe: {
            status: stripeStatus,
            mode: stripeMode,
            publishableKeyConfigured: Boolean(env.STRIPE_PUBLISHABLE_KEY),
            webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET)
          },
          email: {
            status: emailStatus,
            transport: env.SMTP_HOST ? 'smtp' : 'not_configured'
          },
          storage: {
            status: r2Config ? 'configured' : 'not_configured',
            provider: 'cloudflare_r2',
            maxUploadBytes: r2Config?.maxUploadBytes ?? null
          },
          oauth: {
            google: googleOauthStatus,
            microsoft: microsoftOauthStatus
          }
        },
        queue: {
          waitingCount: 0,
          processingCount: 0,
          lagSeconds: 0,
          oldestWaitingAgeSeconds: 0,
          readyCountLastFiveMinutes: 0,
          failedCountLastFiveMinutes: 0,
          byStatus: {
            WAITING: 0,
            PROCESSING: 0,
            READY: 0,
            FAILED: 0,
            EXPIRED: 0,
            CANCELED: 0
          }
        },
        throughput: {
          successfulCheckoutsLastMinute: 0,
          successfulCheckoutsLastFiveMinutes: 0,
          successfulCheckoutsLastFifteenMinutes: 0,
          queueReadyLastFiveMinutes: 0,
          queueFailuresLastFiveMinutes: 0
        },
        errorsLastMinute: 0,
        orders: {
          byStatus: {
            PENDING: 0,
            PAID: 0,
            FINALIZATION_FAILED: 0,
            REFUNDED: 0,
            CANCELED: 0
          }
        },
        holds: {
          activeCount: 0,
          expiringWithinTwoMinutes: 0,
          staleActiveCount: 0,
          byStatus: {
            ACTIVE: 0,
            EXPIRED: 0,
            CONVERTED: 0,
            CANCELED: 0
          }
        },
        webhooks: {
          byStatus: {
            PROCESSING: 0,
            PROCESSED: 0,
            FAILED: 0
          },
          failedLastMinute: 0,
          processedLastFiveMinutes: 0
        },
        seats: {
          total: 0,
          soldPercent: 0,
          byStatus: {
            AVAILABLE: 0,
            HELD: 0,
            SOLD: 0,
            BLOCKED: 0
          }
        },
        system: getSystemSnapshot(),
        lastSuccessfulCheckout: null,
        lastSuccessfulCheckoutSecondsAgo: null,
        cache: {
          diagnosticsQueriedAt: null,
          diagnosticsFromCache: false,
          diagnosticsAgeSeconds: null,
          diagnosticsTtlSeconds: env.HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS
        }
      });
    }
  });
};
