import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { env, isSmtpConfigured } from '../lib/env.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/health', async (_request, reply) => {
    const stripeStatus = env.STRIPE_SECRET_KEY.startsWith('sk_') ? 'configured' : 'missing';
    const emailStatus = isSmtpConfigured() ? 'configured' : 'not_configured';

    try {
      await prisma.$queryRaw`SELECT 1`;
      const schemaCheck = await prisma.$queryRaw<
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
      `;

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
          }
        });
      }

      return {
        status: 'ok',
        dependencies: {
          database: 'ok',
          stripe: stripeStatus,
          email: emailStatus
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
        }
      });
    }
  });
};
