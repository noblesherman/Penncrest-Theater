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
