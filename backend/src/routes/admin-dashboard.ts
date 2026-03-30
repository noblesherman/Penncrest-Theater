import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';

const dashboardQuerySchema = z.object({
  scope: z.enum(['active', 'archived', 'all']).default('active')
});

export const adminDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/dashboard', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = dashboardQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const performanceScopeWhere =
      parsed.data.scope === 'all'
        ? undefined
        : {
            isArchived: parsed.data.scope === 'archived'
          };

    const orderScopeWhere = performanceScopeWhere ? { performance: performanceScopeWhere } : undefined;

    try {
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);

      const [salesToday, seatsSold, totalRevenue, checkIns, grouped] = await Promise.all([
        prisma.order.aggregate({
          where: {
            ...orderScopeWhere,
            status: 'PAID',
            createdAt: {
              gte: dayStart,
              lte: dayEnd
            }
          },
          _sum: {
            amountTotal: true
          }
        }),
        prisma.seat.count({
          where: {
            status: 'SOLD',
            ...(performanceScopeWhere ? { performance: performanceScopeWhere } : {})
          }
        }),
        prisma.order.aggregate({
          where: { status: 'PAID', ...orderScopeWhere },
          _sum: { amountTotal: true }
        }),
        prisma.ticket.count({
          where: {
            checkedInAt: { not: null },
            ...(performanceScopeWhere ? { performance: performanceScopeWhere } : {})
          }
        }),
        prisma.order.groupBy({
          by: ['performanceId'],
          where: { status: 'PAID', ...orderScopeWhere },
          _sum: { amountTotal: true },
          _count: { _all: true }
        })
      ]);

      const performanceIds = grouped.map((row) => row.performanceId);
      const performances = await prisma.performance.findMany({
        where: {
          id: { in: performanceIds },
          ...(performanceScopeWhere || {})
        },
        include: { show: true }
      });
      const performanceMap = new Map(performances.map((p) => [p.id, p]));

      reply.send({
        salesToday: salesToday._sum.amountTotal || 0,
        seatsSold,
        revenue: totalRevenue._sum.amountTotal || 0,
        checkIns,
        salesByPerformance: grouped.map((row) => ({
          performanceId: row.performanceId,
          performanceTitle:
            performanceMap.get(row.performanceId)?.title || performanceMap.get(row.performanceId)?.show.title || 'Performance',
          startsAt: performanceMap.get(row.performanceId)?.startsAt,
          orders: row._count._all,
          revenue: row._sum.amountTotal || 0
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch dashboard metrics');
    }
  });
};
