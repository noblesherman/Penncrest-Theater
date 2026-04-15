import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { checkoutRequestSchema } from '../schemas/checkout.js';
import { handleRouteError } from '../lib/route-error.js';
import { executeCheckoutRequest } from '../services/checkout-execution-service.js';
import { enqueuePaidCheckout, getCheckoutQueueStatus } from '../services/checkout-queue-service.js';
import { env } from '../lib/env.js';
import { getClientIp } from '../lib/client-ip.js';

const queueStatusParamsSchema = z.object({
  queueId: z.string().min(1)
});

const queueStatusQuerySchema = z.object({
  holdToken: z.string().min(8),
  clientToken: z.string().min(8)
});

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/checkout',
    {
      config: {
        rateLimit: {
          max: env.CHECKOUT_ROUTE_RATE_LIMIT_MAX,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const parsed = checkoutRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const payload = {
          ...parsed.data,
          clientIpAddress: parsed.data.clientIpAddress || getClientIp(request)
        };

        if (payload.checkoutMode === 'PAID') {
          const queued = await enqueuePaidCheckout(payload);
          return reply.send(queued);
        }

        const result = await executeCheckoutRequest(payload);
        return reply.send(result);
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError) {
          const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
          return reply.status(statusCode).send({ error: err.message || 'Payment provider error' });
        }

        handleRouteError(reply, err, 'Checkout failed');
      }
    }
  );

  app.get(
    '/api/checkout/queue/:queueId',
    {
      config: {
        rateLimit: {
          max: env.CHECKOUT_QUEUE_STATUS_ROUTE_RATE_LIMIT_MAX,
          timeWindow: '1 minute',
          keyGenerator: (request) => {
            const params = (request.params || {}) as { queueId?: string };
            const query = (request.query || {}) as { clientToken?: string };
            return `${getClientIp(request)}:${params.queueId || 'unknown'}:${query.clientToken || 'unknown'}`;
          }
        }
      }
    },
    async (request, reply) => {
      const parsedParams = queueStatusParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({ error: parsedParams.error.flatten() });
      }

      const parsedQuery = queueStatusQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ error: parsedQuery.error.flatten() });
      }

      try {
        const status = await getCheckoutQueueStatus({
          queueId: parsedParams.data.queueId,
          holdToken: parsedQuery.data.holdToken,
          clientToken: parsedQuery.data.clientToken
        });

        return reply.send(status);
      } catch (err) {
        handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch checkout queue status');
      }
    }
  );
};
