import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { logAudit } from '../lib/audit-log.js';
import { getPenncrestSeatTemplate } from '../lib/penncrest-seating.js';

const tierSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().positive()
});

const createPerformanceSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  posterUrl: z.string().url().optional(),
  type: z.string().optional(),
  year: z.number().int().optional(),
  accentColor: z.string().optional(),
  startsAt: z.string().datetime(),
  salesCutoffAt: z.string().datetime().nullable().optional(),
  staffCompsEnabled: z.boolean().optional(),
  staffCompLimitPerUser: z.number().int().min(1).max(1).optional(),
  staffTicketLimit: z.number().int().min(1).max(10).optional(),
  familyFreeTicketEnabled: z.boolean().optional(),
  venue: z.string().min(1),
  notes: z.string().optional(),
  pricingTiers: z.array(tierSchema).min(1)
});

const updatePerformanceSchema = createPerformanceSchema.partial();

function buildDefaultSeats(performanceId: string): Array<{
  performanceId: string;
  row: string;
  number: number;
  sectionName: string;
  x: number;
  y: number;
  price: number;
  isAccessible: boolean;
  isCompanion: boolean;
}> {
  const seats: Array<{
    performanceId: string;
    row: string;
    number: number;
    sectionName: string;
    x: number;
    y: number;
    price: number;
    isAccessible: boolean;
    isCompanion: boolean;
  }> = [];

  getPenncrestSeatTemplate().forEach((seat) => {
    const premiumRow = ['A', 'B', 'C', 'D'].includes(seat.row);
    seats.push({
      performanceId,
      row: seat.row,
      number: seat.number,
      sectionName: seat.sectionName,
      x: seat.x,
      y: seat.y,
      price: premiumRow ? 2200 : 1800,
      isAccessible: seat.isAccessible,
      isCompanion: false
    });
  });

  return seats;
}

export const adminPerformanceRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/admin/performances', { preHandler: app.authenticateAdmin }, async (_request, reply) => {
    try {
      const performances = await prisma.performance.findMany({
        orderBy: { startsAt: 'asc' },
        include: {
          show: true,
          pricingTiers: true,
          seats: true
        }
      });

      reply.send(
        performances.map((performance) => ({
          id: performance.id,
          title: performance.title || performance.show.title,
          showId: performance.show.id,
          showTitle: performance.show.title,
          startsAt: performance.startsAt,
          salesCutoffAt: performance.salesCutoffAt,
          staffCompsEnabled: performance.staffCompsEnabled,
          staffCompLimitPerUser: performance.staffCompLimitPerUser,
          staffTicketLimit: performance.staffTicketLimit,
          familyFreeTicketEnabled: performance.familyFreeTicketEnabled,
          venue: performance.venue,
          notes: performance.notes,
          seatsTotal: performance.seats.length,
          seatsSold: performance.seats.filter((seat) => seat.status === 'SOLD').length,
          pricingTiers: performance.pricingTiers
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch performances');
    }
  });

  app.post('/api/admin/performances', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = createPerformanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const show = await tx.show.create({
          data: {
            title: parsed.data.title,
            description: parsed.data.description,
            posterUrl: parsed.data.posterUrl,
            type: parsed.data.type,
            year: parsed.data.year,
            accentColor: parsed.data.accentColor
          }
        });

        const performance = await tx.performance.create({
          data: {
            showId: show.id,
            title: parsed.data.title,
            startsAt: new Date(parsed.data.startsAt),
            salesCutoffAt: parsed.data.salesCutoffAt ? new Date(parsed.data.salesCutoffAt) : null,
            staffCompsEnabled: parsed.data.staffCompsEnabled ?? true,
            staffCompLimitPerUser: parsed.data.staffCompLimitPerUser ?? 1,
            staffTicketLimit: parsed.data.staffTicketLimit ?? 2,
            familyFreeTicketEnabled: parsed.data.familyFreeTicketEnabled ?? false,
            venue: parsed.data.venue,
            notes: parsed.data.notes
          }
        });

        await tx.pricingTier.createMany({
          data: parsed.data.pricingTiers.map((tier) => ({
            performanceId: performance.id,
            name: tier.name,
            priceCents: tier.priceCents
          }))
        });

        await tx.seat.createMany({
          data: buildDefaultSeats(performance.id)
        });

        return performance;
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_CREATED',
        entityType: 'Performance',
        entityId: created.id,
        metadata: parsed.data
      });

      reply.status(201).send({ id: created.id });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create performance');
    }
  });

  app.patch('/api/admin/performances/:id', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = updatePerformanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.performance.findUnique({
        where: { id: params.id },
        include: { show: true }
      });
      if (!existing) {
        throw new HttpError(404, 'Performance not found');
      }

      await prisma.$transaction(async (tx) => {
        await tx.performance.update({
          where: { id: params.id },
          data: {
            title: parsed.data.title,
            startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
            salesCutoffAt:
              parsed.data.salesCutoffAt === undefined
                ? undefined
                : parsed.data.salesCutoffAt
                  ? new Date(parsed.data.salesCutoffAt)
                  : null,
            staffCompsEnabled: parsed.data.staffCompsEnabled,
            staffCompLimitPerUser: parsed.data.staffCompLimitPerUser,
            staffTicketLimit: parsed.data.staffTicketLimit,
            familyFreeTicketEnabled: parsed.data.familyFreeTicketEnabled,
            venue: parsed.data.venue,
            notes: parsed.data.notes
          }
        });

        await tx.show.update({
          where: { id: existing.showId },
          data: {
            title: parsed.data.title,
            description: parsed.data.description,
            posterUrl: parsed.data.posterUrl,
            type: parsed.data.type,
            year: parsed.data.year,
            accentColor: parsed.data.accentColor
          }
        });

        if (parsed.data.pricingTiers) {
          await tx.pricingTier.deleteMany({ where: { performanceId: params.id } });
          await tx.pricingTier.createMany({
            data: parsed.data.pricingTiers.map((tier) => ({
              performanceId: params.id,
              name: tier.name,
              priceCents: tier.priceCents
            }))
          });
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_UPDATED',
        entityType: 'Performance',
        entityId: params.id,
        metadata: parsed.data
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update performance');
    }
  });

  app.delete('/api/admin/performances/:id', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const paidOrders = await prisma.order.count({
        where: {
          performanceId: params.id,
          status: 'PAID'
        }
      });
      if (paidOrders > 0) {
        throw new HttpError(400, 'Cannot delete a performance with paid orders');
      }

      await prisma.performance.delete({ where: { id: params.id } });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_DELETED',
        entityType: 'Performance',
        entityId: params.id
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to delete performance');
    }
  });
};
