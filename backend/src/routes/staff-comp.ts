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
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z.string().email(),
  seatId: z.string().min(1).optional(),
  attendeeName: z.string().trim().min(1).max(80).optional()
});

export const staffCompRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/tickets/staff-comp/reserve',
    {
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

      try {
        await validateTeacherCompPromoCode(parsed.data.teacherPromoCode);

        const normalizedCustomerEmail = parsed.data.customerEmail.trim().toLowerCase();
        const normalizedCustomerName = parsed.data.customerName.trim();
        if (normalizedCustomerEmail.endsWith('@rtmsd.org')) {
          throw new HttpError(400, 'Use a personal email for ticket delivery (not @rtmsd.org)');
        }

        const performance = await prisma.performance.findFirst({
          where: { id: parsed.data.performanceId, isArchived: false },
          select: {
            id: true,
            startsAt: true,
            onlineSalesStartsAt: true,
            salesCutoffAt: true,
            isPublished: true,
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

        if (!performance.isPublished || (performance.onlineSalesStartsAt && performance.onlineSalesStartsAt > new Date())) {
          throw new HttpError(400, 'Online sales are not live for this performance yet');
        }

        const salesCutoffAt = performance.salesCutoffAt || performance.startsAt;
        if (salesCutoffAt <= new Date()) {
          throw new HttpError(400, 'Online sales are closed for this performance');
        }

        const userRedemptionCount = await prisma.order.count({
          where: {
            performanceId: performance.id,
            source: 'STAFF_COMP',
            email: normalizedCustomerEmail,
            status: { not: 'CANCELED' }
          }
        });

        const perUserLimit = Math.max(1, performance.staffCompLimitPerUser || 1);
        if (userRedemptionCount >= perUserLimit) {
          throw new HttpError(409, `Staff comp limit reached for this email on this performance (${perUserLimit})`);
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
          customerName: normalizedCustomerName,
          customerEmail: normalizedCustomerEmail,
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
          actor: normalizedCustomerEmail,
          action: 'STAFF_COMP_REDEEMED',
          entityType: 'Ticket',
          entityId: ticket.id,
          metadata: {
            performanceId: performance.id,
            ticketId: ticket.id,
            orderId: order.id,
            seatId,
            customerEmail: normalizedCustomerEmail
          }
        });

        return reply.status(201).send({
          orderId: order.id,
          orderAccessToken: order.accessToken,
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
