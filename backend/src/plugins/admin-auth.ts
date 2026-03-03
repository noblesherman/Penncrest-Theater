import fp from 'fastify-plugin';
import { FastifyReply, FastifyRequest } from 'fastify';

export const adminAuthPlugin = fp(async (app) => {
  app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'admin' || !request.user.username) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});
