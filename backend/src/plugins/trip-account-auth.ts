/*
Handoff note for Mr. Smith:
- File: `backend/src/plugins/trip-account-auth.ts`
- What this is: Fastify plugin module.
- What it does: Configures shared request lifecycle behavior (auth/security/rate limits/etc).
- Connections: Loaded early in server bootstrap before route registration.
- Main content type: Cross-cutting server configuration.
- Safe edits here: Documentation notes and conservative config explanation updates.
- Be careful with: Default values that affect every request across the backend.
- Useful context: If requests fail before route handlers run, inspect plugins first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import fp from 'fastify-plugin';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';

type TripAccountJwtPayload = {
  role: 'trip_account';
  tripAccountId?: string;
  tripAccountEmail?: string;
};

export const tripAccountAuthPlugin = fp(async (app) => {
  app.decorate('authenticateTripAccount', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'trip_account') {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const payload = request.user as TripAccountJwtPayload;
      if (!payload.tripAccountId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const account = await prisma.tripAccount.findUnique({
        where: { id: payload.tripAccountId }
      });

      if (!account || !account.isActive) {
        return reply.status(403).send({ error: 'Account inactive' });
      }

      request.tripAccount = account;
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});
