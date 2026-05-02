/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/admin-seats.ts`
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
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';
import { HttpError } from '../lib/http-error.js';

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

function toSeatStatus(status: string): 'available' | 'held' | 'sold' | 'blocked' {
  return status.toLowerCase() as 'available' | 'held' | 'sold' | 'blocked';
}

function toDisplayedSeatStatus(seat: {
  status: string;
  tickets?: Array<{ id: string }>;
}): 'available' | 'held' | 'sold' | 'blocked' {
  if ((seat.tickets || []).length > 0) {
    return 'sold';
  }

  return toSeatStatus(seat.status);
}

async function assertPerformanceEditable(performanceId: string): Promise<void> {
  const performance = await prisma.performance.findUnique({
    where: { id: performanceId },
    select: {
      id: true,
      isArchived: true
    }
  });

  if (!performance) {
    throw new HttpError(404, 'Performance not found');
  }

  if (performance.isArchived) {
    throw new HttpError(409, 'Archived performances are read-only');
  }
}

export const adminSeatRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/admin/performances/:performanceId/seats', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { performanceId: string };

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: params.performanceId },
        select: { id: true }
      });
      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      const seats = await prisma.seat.findMany({
        where: { performanceId: params.performanceId },
        include: {
          tickets: {
            where: { status: 'ISSUED' },
            select: { id: true }
          }
        },
        orderBy: [{ sectionName: 'asc' }, { row: 'asc' }, { number: 'asc' }]
      });
      const issuedTickets = await prisma.ticket.findMany({
        where: {
          performanceId: params.performanceId,
          status: 'ISSUED',
          seatId: { not: null }
        },
        select: {
          seatId: true,
          orderId: true,
          order: {
            select: {
              id: true,
              customerName: true,
              orderSeats: {
                where: { seatId: { not: null } },
                select: { seatId: true, attendeeName: true }
              },
              tickets: {
                where: {
                  performanceId: params.performanceId,
                  status: 'ISSUED',
                  seatId: { not: null }
                },
                select: { seatId: true }
              }
            }
          }
        }
      });
      const occupiedBySeatId = new Map<
        string,
        { orderId: string; customerName: string; displayName: string; seatIds: string[] }
      >();

      issuedTickets.forEach((ticket) => {
        if (!ticket.seatId) {
          return;
        }

        const relatedSeatIds = [
          ...new Set(
            [
              ...ticket.order.orderSeats.map((orderSeat) => orderSeat.seatId),
              ...ticket.order.tickets.map((orderTicket) => orderTicket.seatId)
            ].filter((seatId): seatId is string => Boolean(seatId))
          )
        ];
        const currentOrderSeat = ticket.order.orderSeats.find((orderSeat) => orderSeat.seatId === ticket.seatId);
        const displayName = currentOrderSeat?.attendeeName?.trim() || ticket.order.customerName;

        occupiedBySeatId.set(ticket.seatId, {
          orderId: ticket.orderId,
          customerName: ticket.order.customerName,
          displayName,
          seatIds: relatedSeatIds
        });
      });

      reply.send(
        seats.map((seat) => ({
          id: seat.id,
          row: seat.row,
          number: seat.number,
          x: seat.x,
          y: seat.y,
          status: toDisplayedSeatStatus(seat),
          isAccessible: seat.isAccessible,
          isCompanion: seat.isCompanion,
          companionForSeatId: seat.companionForSeatId,
          sectionName: seat.sectionName,
          price: seat.price,
          occupiedBy: occupiedBySeatId.get(seat.id) || null
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch seats');
    }
  });

  app.post('/api/admin/seats/block', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = mutateSeatsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, seatIds } = parsed.data;

    try {
      await assertPerformanceEditable(performanceId);

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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to block seats');
    }
  });

  app.post('/api/admin/seats/unblock', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = mutateSeatsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, seatIds } = parsed.data;

    try {
      await assertPerformanceEditable(performanceId);

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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to unblock seats');
    }
  });

  app.post('/api/admin/seats/update', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = updateSeatFlagsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, seatId, isAccessible, isCompanion, companionForSeatId } = parsed.data;

    try {
      await assertPerformanceEditable(performanceId);

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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to update seat flags');
    }
  });
};
