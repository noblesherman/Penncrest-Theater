import fp from 'fastify-plugin';
import { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRole } from '@prisma/client';
import { hasAdminRole } from '../lib/admin-users.js';
import { prisma } from '../lib/prisma.js';

export const adminAuthPlugin = fp(async (app) => {
  app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'admin' || !request.user.adminId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const adminUser = await prisma.adminUser.findUnique({
        where: { id: request.user.adminId }
      });

      if (!adminUser || !adminUser.isActive) {
        return reply.status(403).send({ error: 'Account inactive' });
      }

      request.adminUser = adminUser;
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.decorate('requireAdminRole', (role: AdminRole) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticateAdmin(request, reply);
      if (reply.sent) {
        return;
      }

      if (!request.adminUser || !hasAdminRole(request.adminUser.role, role)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
    };
  });
});
