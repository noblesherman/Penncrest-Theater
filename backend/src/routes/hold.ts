/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/hold.ts`
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
import { holdRequestSchema } from '../schemas/hold.js';
import { syncSeatHold } from '../services/hold-service.js';
import { handleRouteError } from '../lib/route-error.js';
import { env } from '../lib/env.js';

export const holdRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/hold',
    {
      config: {
        rateLimit: {
          max: env.HOLD_ROUTE_RATE_LIMIT_MAX,
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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to sync hold');
    }
    }
  );
};
