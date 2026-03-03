import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';

const mutateSeatsSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(500)
});

const updateSeatFlagsSchema = z
  .object({
    performanceId: z.string().min(1),
    seatId: z.string().min(1),
    isAccessible: z.boolean().optional(),
    isCompanion: z.boolean().optional(),
    companionForSeatId: z.string().min(1).nullable().optional()
  })
  .refine(
    (value) =>
      value.isAccessible !== undefined ||
      value.isCompanion !== undefined ||
      value.companionForSeatId !== undefined,
    'Provide at least one seat flag to update'
  );

async function closeEmptyHolds(holdIds: string[]): Promise<void> {
  if (!holdIds.length) {
    return;
  }

  const candidates = await prisma.holdSession.findMany({
    where: {
      id: { in: holdIds },
      status: 'ACTIVE'
    },
    include: { seatHolds: true }
  });

  const emptyIds = candidates.filter((hold) => hold.seatHolds.length === 0).map((hold) => hold.id);
  if (!emptyIds.length) {
    return;
  }

  await prisma.holdSession.updateMany({
    where: { id: { in: emptyIds } },
    data: { status: 'CANCELED' }
  });
}

export const adminSeatRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.post('/api/admin/seats/block', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = mutateSeatsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, seatIds } = parsed.data;

    try {
      const holdIds = await prisma.seat.findMany({
        where: {
          id: { in: seatIds },
          performanceId,
          holdSessionId: { not: null }
        },
        select: { holdSessionId: true }
      });

      await prisma.$transaction(async (tx) => {
        await tx.seat.updateMany({
          where: {
            id: { in: seatIds },
            performanceId,
            status: { in: ['AVAILABLE', 'HELD'] }
          },
          data: {
            status: 'BLOCKED',
            holdSessionId: null
          }
        });

        await tx.seatHold.deleteMany({
          where: {
            seatId: { in: seatIds }
          }
        });
      });

      await closeEmptyHolds(holdIds.map((h) => h.holdSessionId!).filter(Boolean));

      await logAudit({
        actor: adminActor(request),
        action: 'SEATS_BLOCKED',
        entityType: 'Performance',
        entityId: performanceId,
        metadata: { seatIds }
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to block seats');
    }
  });

  app.post('/api/admin/seats/unblock', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = mutateSeatsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, seatIds } = parsed.data;

    try {
      await prisma.seat.updateMany({
        where: {
          id: { in: seatIds },
          performanceId,
          status: 'BLOCKED'
        },
        data: {
          status: 'AVAILABLE'
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'SEATS_UNBLOCKED',
        entityType: 'Performance',
        entityId: performanceId,
        metadata: { seatIds }
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to unblock seats');
    }
  });

  app.post('/api/admin/seats/update', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = updateSeatFlagsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, seatId, isAccessible, isCompanion, companionForSeatId } = parsed.data;

    try {
      if (companionForSeatId) {
        const targetAccessible = await prisma.seat.findFirst({
          where: {
            id: companionForSeatId,
            performanceId,
            isAccessible: true
          },
          select: { id: true }
        });

        if (!targetAccessible) {
          return reply.status(400).send({ error: 'Companion target must be an accessible seat in this performance' });
        }
      }

      const updated = await prisma.seat.updateMany({
        where: {
          id: seatId,
          performanceId
        },
        data: {
          isAccessible,
          isCompanion,
          companionForSeatId:
            companionForSeatId !== undefined
              ? companionForSeatId
              : isCompanion === false
                ? null
                : undefined
        }
      });

      if (updated.count === 0) {
        return reply.status(404).send({ error: 'Seat not found for this performance' });
      }

      await logAudit({
        actor: adminActor(request),
        action: 'SEAT_FLAGS_UPDATED',
        entityType: 'Performance',
        entityId: performanceId,
        metadata: {
          seatId,
          isAccessible,
          isCompanion,
          companionForSeatId
        }
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update seat flags');
    }
  });
};
