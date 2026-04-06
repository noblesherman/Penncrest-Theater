import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { env, isSmtpConfigured } from '../lib/env.js';
import { getCheckoutQueueMetrics } from '../services/checkout-queue-service.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/health', async (_request, reply) => {
    const stripeStatus = env.STRIPE_SECRET_KEY.startsWith('sk_') ? 'configured' : 'missing';
    const emailStatus = isSmtpConfigured() ? 'configured' : 'not_configured';

    try {
      const [_, schemaCheck, queueMetrics] = await Promise.all([
        prisma.$queryRaw`SELECT 1`,
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
        getCheckoutQueueMetrics()
      ]);

      const schemaReady =
        schemaCheck[0]?.accessTokenColumn &&
        schemaCheck[0]?.stripeRefundIdColumn &&
        schemaCheck[0]?.finalizationFailedEnum;

      if (!schemaReady) {
        app.log.error('Health check failed: database schema is missing production-hardening migration');

        return reply.status(503).send({
          status: 'degraded',
          dependencies: {
            database: 'schema_mismatch',
            stripe: stripeStatus,
            email: emailStatus
          },
          queue: {
            waitingCount: queueMetrics.waitingCount,
            processingCount: queueMetrics.processingCount,
            oldestWaitingAgeSeconds: queueMetrics.oldestWaitingAgeSeconds,
            readyCountLastFiveMinutes: queueMetrics.readyCountLastFiveMinutes,
            failedCountLastFiveMinutes: queueMetrics.failedCountLastFiveMinutes
          }
        });
      }

      return {
        status: 'ok',
        dependencies: {
          database: 'ok',
          stripe: stripeStatus,
          email: emailStatus
        },
        queue: {
          waitingCount: queueMetrics.waitingCount,
          processingCount: queueMetrics.processingCount,
          oldestWaitingAgeSeconds: queueMetrics.oldestWaitingAgeSeconds,
          readyCountLastFiveMinutes: queueMetrics.readyCountLastFiveMinutes,
          failedCountLastFiveMinutes: queueMetrics.failedCountLastFiveMinutes
        }
      };
    } catch (err) {
      app.log.error({ err }, 'Health check failed');
      return reply.status(503).send({
        status: 'degraded',
        dependencies: {
          database: 'unavailable',
          stripe: stripeStatus,
          email: emailStatus
        },
        queue: {
          waitingCount: 0,
          processingCount: 0,
          oldestWaitingAgeSeconds: 0,
          readyCountLastFiveMinutes: 0,
          failedCountLastFiveMinutes: 0
        }
      });
    }
  });
};
