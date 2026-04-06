import { FastifyPluginAsync } from 'fastify';
import { holdRequestSchema } from '../schemas/hold.js';
import { syncSeatHold } from '../services/hold-service.js';
import { handleRouteError } from '../lib/route-error.js';

export const holdRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/hold',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
    const parsed = holdRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const result = await syncSeatHold(parsed.data);
      reply.send({
        holdToken: result.holdToken,
        expiresAt: result.expiresAt.toISOString(),
        heldSeatIds: result.heldSeatIds
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to sync hold');
    }
    }
  );
};
