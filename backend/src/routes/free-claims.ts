import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { createAssignedOrder } from '../services/order-assignment.js';

const familyClaimSchema = z.object({
  performanceId: z.string().min(1),
  seatId: z.string().min(1),
  customerName: z.string().min(1).max(120),
  customerEmail: z.string().email(),
  attendeeName: z.string().max(80).optional()
});

export const freeClaimRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/staff-tickets/claim', async (request, reply) => {
    return reply.status(410).send({
      error:
        'Legacy staff claims are disabled. Use OAuth or redeem-code verification and /tickets/staff-comp/reserve.'
    });
  });

  app.post('/api/family-ticket/claim', async (request, reply) => {
    const parsed = familyClaimSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const email = parsed.data.customerEmail.toLowerCase();

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: parsed.data.performanceId },
        select: {
          id: true,
          showId: true,
          familyFreeTicketEnabled: true
        }
      });

      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      if (!performance.familyFreeTicketEnabled) {
        throw new HttpError(400, 'Family free ticket offers are not enabled for this performance');
      }

      const existingClaim = await prisma.order.findFirst({
        where: {
          email,
          source: 'FAMILY_FREE',
          status: 'PAID',
          performance: {
            showId: performance.showId
          }
        },
        select: { id: true }
      });

      if (existingClaim) {
        throw new HttpError(409, 'A family free ticket has already been claimed for this show run with this email');
      }

      const attendeeNames = parsed.data.attendeeName ? { [parsed.data.seatId]: parsed.data.attendeeName } : undefined;
      const ticketTypeBySeatId = { [parsed.data.seatId]: 'Family Free' };

      const order = await createAssignedOrder({
        performanceId: parsed.data.performanceId,
        seatIds: [parsed.data.seatId],
        customerName: parsed.data.customerName,
        customerEmail: email,
        attendeeNames,
        ticketTypeBySeatId,
        source: 'FAMILY_FREE',
        allowHeldSeats: false,
        enforceSalesCutoff: true,
        sendEmail: true
      });

      reply.status(201).send({
        orderId: order.id,
        performanceId: order.performanceId,
        seatCount: order.orderSeats.length,
        source: order.source
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to claim family free ticket');
    }
  });
};
