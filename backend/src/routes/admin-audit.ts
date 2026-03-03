import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';

export const adminAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/audit-logs', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const query = request.query as {
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(Number(query.page || '1'), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize || '50'), 1), 200);

    try {
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize
        }),
        prisma.auditLog.count()
      ]);

      reply.send({
        page,
        pageSize,
        total,
        rows
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch audit logs');
    }
  });
};
