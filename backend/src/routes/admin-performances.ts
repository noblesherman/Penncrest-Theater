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

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value);
}

const imageSourceSchema = z
  .string()
  .max(2_000_000)
  .refine((value) => isHttpUrl(value) || isImageDataUrl(value), {
    message: 'Image must be an image URL or image data URL'
  });

const castMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    photoUrl: imageSourceSchema.optional()
  });

const performanceScheduleSchema = z.object({
  title: z.string().min(1).optional(),
  startsAt: z.string().datetime(),
  salesCutoffAt: z.string().datetime().nullable().optional()
});

const createPerformanceSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  posterUrl: imageSourceSchema.optional(),
  type: z.string().optional(),
  year: z.number().int().optional(),
  accentColor: z.string().optional(),
  startsAt: z.string().datetime().optional(),
  salesCutoffAt: z.string().datetime().nullable().optional(),
  performances: z.array(performanceScheduleSchema).min(1).optional(),
  staffCompsEnabled: z.boolean().optional(),
  staffCompLimitPerUser: z.number().int().min(1).max(1).optional(),
  staffTicketLimit: z.number().int().min(1).max(10).optional(),
  familyFreeTicketEnabled: z.boolean().optional(),
  venue: z.string().min(1),
  notes: z.string().optional(),
  pricingTiers: z.array(tierSchema).min(1),
  castMembers: z.array(castMemberSchema).max(80).optional()
});

const updatePerformanceSchema = createPerformanceSchema.partial();
const listPerformanceQuerySchema = z.object({
  scope: z.enum(['active', 'archived', 'all']).default('active')
});
const deletePerformanceQuerySchema = z.object({
  force: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
});

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

  app.get('/api/admin/performances', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = listPerformanceQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const where =
      parsed.data.scope === 'all'
        ? undefined
        : {
            isArchived: parsed.data.scope === 'archived'
          };

    try {
      const performances = await prisma.performance.findMany({
        where,
        orderBy: [{ isArchived: 'asc' }, { startsAt: 'desc' }],
        include: {
          show: {
            include: {
              castMembers: {
                orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
              }
            }
          },
          pricingTiers: true,
          seats: true,
          orders: {
            select: {
              status: true,
              amountTotal: true
            }
          }
        }
      });

      reply.send(
        performances.map((performance) => ({
          id: performance.id,
          title: performance.title || performance.show.title,
          showId: performance.show.id,
          showTitle: performance.show.title,
          showDescription: performance.show.description,
          showPosterUrl: performance.show.posterUrl,
          showType: performance.show.type,
          showYear: performance.show.year,
          showAccentColor: performance.show.accentColor,
          startsAt: performance.startsAt,
          salesCutoffAt: performance.salesCutoffAt,
          isArchived: performance.isArchived,
          archivedAt: performance.archivedAt,
          staffCompsEnabled: performance.staffCompsEnabled,
          staffCompLimitPerUser: performance.staffCompLimitPerUser,
          staffTicketLimit: performance.staffTicketLimit,
          familyFreeTicketEnabled: performance.familyFreeTicketEnabled,
          venue: performance.venue,
          notes: performance.notes,
          seatsTotal: performance.seats.length,
          seatsSold: performance.seats.filter((seat) => seat.status === 'SOLD').length,
          totalOrders: performance.orders.length,
          paidOrders: performance.orders.filter((order) => order.status === 'PAID').length,
          paidRevenueCents: performance.orders
            .filter((order) => order.status === 'PAID')
            .reduce((sum, order) => sum + order.amountTotal, 0),
          pricingTiers: performance.pricingTiers,
          castMembers: performance.show.castMembers.map((castMember) => ({
            id: castMember.id,
            name: castMember.name,
            role: castMember.role,
            photoUrl: castMember.photoUrl
          }))
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch performances');
    }
  });

  app.post('/api/admin/performances', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createPerformanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const scheduleEntries =
      parsed.data.performances && parsed.data.performances.length > 0
        ? parsed.data.performances
        : parsed.data.startsAt
          ? [
              {
                title: parsed.data.title,
                startsAt: parsed.data.startsAt,
                salesCutoffAt: parsed.data.salesCutoffAt ?? null
              }
            ]
          : [];
    if (scheduleEntries.length === 0) {
      return reply.status(400).send({ error: 'Provide at least one performance schedule entry.' });
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

        const performanceIds: string[] = [];
        for (const scheduleEntry of scheduleEntries) {
          const performance = await tx.performance.create({
            data: {
              showId: show.id,
              title: scheduleEntry.title || parsed.data.title,
              startsAt: new Date(scheduleEntry.startsAt),
              salesCutoffAt: scheduleEntry.salesCutoffAt ? new Date(scheduleEntry.salesCutoffAt) : null,
              staffCompsEnabled: parsed.data.staffCompsEnabled ?? true,
              staffCompLimitPerUser: parsed.data.staffCompLimitPerUser ?? 1,
              staffTicketLimit: parsed.data.staffTicketLimit ?? 2,
              familyFreeTicketEnabled: parsed.data.familyFreeTicketEnabled ?? false,
              venue: parsed.data.venue,
              notes: parsed.data.notes
            }
          });
          performanceIds.push(performance.id);

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
        }

        if (parsed.data.castMembers && parsed.data.castMembers.length > 0) {
          await tx.castMember.createMany({
            data: parsed.data.castMembers.map((castMember, position) => ({
              showId: show.id,
              name: castMember.name,
              role: castMember.role,
              photoUrl: castMember.photoUrl || null,
              position
            }))
          });
        }

        return performanceIds;
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_CREATED',
        entityType: 'Performance',
        entityId: created[0],
        metadata: {
          ...parsed.data,
          performanceCount: created.length
        }
      });

      reply.status(201).send({ id: created[0], ids: created });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create performance');
    }
  });

  app.patch('/api/admin/performances/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
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

        if (parsed.data.castMembers !== undefined) {
          await tx.castMember.deleteMany({
            where: { showId: existing.showId }
          });

          if (parsed.data.castMembers.length > 0) {
            await tx.castMember.createMany({
              data: parsed.data.castMembers.map((castMember, position) => ({
                showId: existing.showId,
                name: castMember.name,
                role: castMember.role,
                photoUrl: castMember.photoUrl || null,
                position
              }))
            });
          }
        }

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

  app.post('/api/admin/performances/:id/archive', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const existing = await prisma.performance.findUnique({
        where: { id: params.id },
        select: { id: true }
      });
      if (!existing) {
        throw new HttpError(404, 'Performance not found');
      }

      const updated = await prisma.performance.update({
        where: { id: params.id },
        data: {
          isArchived: true,
          archivedAt: new Date()
        },
        select: {
          id: true,
          isArchived: true,
          archivedAt: true
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_ARCHIVED',
        entityType: 'Performance',
        entityId: params.id
      });

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to archive performance');
    }
  });

  app.post('/api/admin/performances/:id/restore', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const existing = await prisma.performance.findUnique({
        where: { id: params.id },
        select: { id: true }
      });
      if (!existing) {
        throw new HttpError(404, 'Performance not found');
      }

      const updated = await prisma.performance.update({
        where: { id: params.id },
        data: {
          isArchived: false,
          archivedAt: null
        },
        select: {
          id: true,
          isArchived: true,
          archivedAt: true
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_RESTORED',
        entityType: 'Performance',
        entityId: params.id
      });

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to restore performance');
    }
  });

  app.delete('/api/admin/performances/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsedQuery = deletePerformanceQuerySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }
    const forceDelete = parsedQuery.data.force === '1' || parsedQuery.data.force === 'true';

    try {
      const deleteMeta = await prisma.$transaction(async (tx) => {
        const performance = await tx.performance.findUnique({
          where: { id: params.id },
          select: { id: true, showId: true }
        });
        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }

        const paidOrders = await tx.order.count({
          where: {
            performanceId: params.id,
            status: 'PAID'
          }
        });
        if (paidOrders > 0 && !forceDelete) {
          throw new HttpError(
            409,
            `This performance has ${paidOrders} paid order(s). Confirm again to permanently delete it.`
          );
        }

        const totalOrders = await tx.order.count({ where: { performanceId: params.id } });
        if (totalOrders > 0) {
          await tx.order.deleteMany({ where: { performanceId: params.id } });
        }

        await tx.performance.delete({ where: { id: params.id } });

        return {
          paidOrders,
          totalOrders
        };
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_DELETED',
        entityType: 'Performance',
        entityId: params.id,
        metadata: {
          forceDelete,
          paidOrdersDeleted: deleteMeta.paidOrders,
          totalOrdersDeleted: deleteMeta.totalOrders
        }
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to delete performance');
    }
  });
};
