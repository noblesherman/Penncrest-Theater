import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { createAssignedOrder } from '../services/order-assignment.js';
import { logAudit } from '../lib/audit-log.js';
import { validateTeacherCompPromoCode } from '../services/teacher-comp-promo-code-service.js';

const reserveStaffCompSchema = z.object({
  performanceId: z.string().min(1),
  teacherPromoCode: z.string().min(4).max(64),
  seatId: z.string().min(1).optional(),
  attendeeName: z.string().trim().min(1).max(80).optional()
});

export const staffCompRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/tickets/staff-comp/reserve',
    {
      preHandler: app.authenticateUser,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '5 minutes'
        }
      }
    },
    async (request, reply) => {
      const parsed = reserveStaffCompSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const user = request.staffUser;
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        if (!user.verifiedStaff) {
          throw new HttpError(403, 'Staff verification is required before reserving a comp ticket');
        }

        await validateTeacherCompPromoCode(parsed.data.teacherPromoCode);

        const performance = await prisma.performance.findFirst({
          where: { id: parsed.data.performanceId, isArchived: false },
          select: {
            id: true,
            startsAt: true,
            salesCutoffAt: true,
            staffCompsEnabled: true,
            staffCompLimitPerUser: true
          }
        });

        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }

        if (!performance.staffCompsEnabled) {
          throw new HttpError(400, 'Staff comps are disabled for this performance');
        }

        const salesCutoffAt = performance.salesCutoffAt || performance.startsAt;
        if (salesCutoffAt <= new Date()) {
          throw new HttpError(400, 'Online sales are closed for this performance');
        }

        const userRedemptionCount = await prisma.staffCompRedemption.count({
          where: {
            performanceId: performance.id,
            userId: user.id
          }
        });

        const perUserLimit = Math.max(1, performance.staffCompLimitPerUser || 1);
        if (userRedemptionCount >= perUserLimit) {
          throw new HttpError(409, `Staff comp limit reached for this performance (${perUserLimit})`);
        }

        const seatCount = await prisma.seat.count({ where: { performanceId: performance.id } });
        if (seatCount <= 0) {
          throw new HttpError(400, 'No seats are configured for this performance');
        }

        const seatId = parsed.data.seatId;
        if (!seatId) {
          throw new HttpError(400, 'Seat selection is required for staff comp reservations');
        }

        const seat = await prisma.seat.findFirst({
          where: {
            id: seatId,
            performanceId: performance.id
          },
          select: {
            id: true,
            status: true,
            isCompanion: true
          }
        });

        if (!seat) {
          throw new HttpError(404, 'Seat not found for this performance');
        }

        if (seat.status !== 'AVAILABLE') {
          throw new HttpError(409, 'Selected seat is no longer available');
        }

        if (seat.isCompanion) {
          throw new HttpError(400, 'Companion seats require a paired accessible seat');
        }

        const attendeeNames = parsed.data.attendeeName ? { [seatId]: parsed.data.attendeeName } : undefined;

        const order = await createAssignedOrder({
          performanceId: performance.id,
          seatIds: [seatId],
          userId: user.id,
          staffCompRedemptionUserId: user.id,
          customerName: user.name,
          customerEmail: user.email,
          attendeeNames,
          ticketTypeBySeatId: { [seatId]: 'Staff Comp' },
          priceBySeatId: { [seatId]: 0 },
          source: 'STAFF_COMP',
          allowHeldSeats: false,
          enforceSalesCutoff: true,
          sendEmail: true
        });

        const ticket = order.tickets[0];

        await logAudit({
          actor: user.email,
          actorUserId: user.id,
          action: 'STAFF_COMP_REDEEMED',
          entityType: 'Ticket',
          entityId: ticket.id,
          metadata: {
            performanceId: performance.id,
            ticketId: ticket.id,
            orderId: order.id,
            seatId
          }
        });

        return reply.status(201).send({
          orderId: order.id,
          ticket: {
            id: ticket.id,
            publicId: ticket.publicId,
            performanceId: performance.id,
            seatId,
            type: ticket.type,
            status: ticket.status,
            priceCents: ticket.priceCents
          }
        });
      } catch (err) {
        handleRouteError(reply, err, 'Failed to reserve staff comp ticket');
      }
    }
  );
};
