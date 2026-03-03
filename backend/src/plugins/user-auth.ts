import fp from 'fastify-plugin';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';

type UserJwtPayload = {
  role: 'user';
  userId?: string;
  email?: string;
};

export const userAuthPlugin = fp(async (app) => {
  app.decorate('authenticateUser', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'user') {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const payload = request.user as UserJwtPayload;
      if (!payload.userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      request.staffUser = user;
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});
