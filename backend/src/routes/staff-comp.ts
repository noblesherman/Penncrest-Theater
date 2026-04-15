import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { getClientIp } from '../lib/client-ip.js';
import { hashRedeemCode, normalizeRedeemCode } from '../lib/staff-code.js';
import { createAssignedOrder } from '../services/order-assignment.js';
import { logAudit } from '../lib/audit-log.js';
import { validateTeacherCompPromoCode } from '../services/teacher-comp-promo-code-service.js';
import { evaluateStaffCompReserveGuards, recordStaffCompReserveAttempt } from '../services/staff-comp-reserve-security.js';

const reserveStaffCompSchema = z.object({
  performanceId: z.string().min(1),
  teacherPromoCode: z.string().min(4).max(64),
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z.string().email(),
  seatId: z.string().min(1).optional(),
  attendeeName: z.string().trim().min(1).max(80).optional()
});

function classifyReserveFailureReason(err: unknown): string {
  if (!(err instanceof HttpError)) {
    return 'UNHANDLED_ERROR';
  }

  if (err.statusCode === 400 && err.message.toLowerCase().includes('promo code')) {
    return 'INVALID_PROMO_CODE';
  }

  if (err.statusCode === 400 && err.message.toLowerCase().includes('sales are')) {
    return 'SALES_WINDOW_CLOSED';
  }

  if (err.statusCode === 400 && err.message.toLowerCase().includes('seat')) {
    return 'SEAT_VALIDATION_FAILED';
  }

  if (err.statusCode === 404) {
    return 'ENTITY_NOT_FOUND';
  }

  if (err.statusCode === 409) {
    return 'STATE_CONFLICT';
  }

  if (err.statusCode === 429) {
    return 'RATE_LIMITED';
  }

  if (err.statusCode >= 500) {
    return 'SERVER_ERROR';
  }

  return `HTTP_${err.statusCode}`;
}

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

      const now = new Date();
      const normalizedCustomerEmail = parsed.data.customerEmail.trim().toLowerCase();
      const normalizedCustomerName = parsed.data.customerName.trim();
      const normalizedPromoCode = normalizeRedeemCode(parsed.data.teacherPromoCode);
      const promoCodeHash = hashRedeemCode(normalizedPromoCode);
      const clientIp = getClientIp(request);

      const recordAttempt = async (params: {
        outcome: 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
        failureReason?: string;
        orderId?: string;
        ticketId?: string;
        lockoutApplied?: boolean;
      }) => {
        try {
          return await recordStaffCompReserveAttempt({
            now,
            requestedPerformanceId: parsed.data.performanceId,
            clientIp,
            customerEmail: normalizedCustomerEmail,
            promoCodeHash,
            outcome: params.outcome,
            failureReason: params.failureReason,
            orderId: params.orderId,
            ticketId: params.ticketId,
            lockoutApplied: params.lockoutApplied
          });
        } catch (recordErr) {
          app.log.error({ err: recordErr }, 'We hit a small backstage snag while trying to record staff comp reservation attempt');
          return { lockoutApplied: false };
        }
      };

      const guardFailure = await evaluateStaffCompReserveGuards({
        now,
        clientIp,
        customerEmail: normalizedCustomerEmail,
        promoCodeHash
      });

      if (guardFailure) {
        await recordAttempt({
          outcome: 'BLOCKED',
          failureReason: guardFailure.reason,
          lockoutApplied: guardFailure.lockoutApplied
        });
        reply.header('Retry-After', String(guardFailure.retryAfterSeconds));
        return reply.status(429).send({
          error: guardFailure.message,
          retryAfterSeconds: guardFailure.retryAfterSeconds
        });
      }

      try {
        await validateTeacherCompPromoCode(parsed.data.teacherPromoCode);
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

        await recordAttempt({
          outcome: 'SUCCEEDED',
          orderId: order.id,
          ticketId: ticket.id
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
        await recordAttempt({
          outcome: 'FAILED',
          failureReason: classifyReserveFailureReason(err)
        });
        handleRouteError(reply, err, 'We hit a small backstage snag while trying to reserve staff comp ticket');
      }
    }
  );
};
