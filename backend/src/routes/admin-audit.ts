/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/admin-audit.ts`
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
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';

export const adminAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/audit-logs', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch audit logs');
    }
  });
};
