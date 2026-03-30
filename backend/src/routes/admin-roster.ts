import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';

export const adminRosterRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/roster', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const querySchema = z.object({
      performanceId: z.string().optional(),
      q: z.string().optional(),
      scope: z.enum(['active', 'archived', 'all']).default('active')
    });
    const parsedQuery = querySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }
    const query = parsedQuery.data;

    try {
      const orders = await prisma.order.findMany({
        where: {
          status: 'PAID',
          ...(query.performanceId ? { performanceId: query.performanceId } : {}),
          ...(query.scope !== 'all'
            ? {
                performance: {
                  isArchived: query.scope === 'archived'
                }
              }
            : {})
        },
        include: {
          performance: { include: { show: true } },
          orderSeats: { include: { seat: true }, orderBy: { createdAt: 'asc' } },
          tickets: { orderBy: { createdAt: 'asc' } }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      const rows = orders.flatMap((order) => {
        const isGeneralAdmission = order.performance.seatSelectionEnabled === false;
        const ticketBySeatId = new Map(
          order.tickets
            .filter((ticket) => Boolean(ticket.seatId))
            .map((ticket) => [ticket.seatId, ticket])
        );
        const gaTickets = order.tickets.filter((ticket) => !ticket.seatId);
        let gaTicketCursor = 0;

        return order.orderSeats.map((orderSeat, index) => {
          const matchedTicket =
            (orderSeat.seatId ? ticketBySeatId.get(orderSeat.seatId) : null) || gaTickets[gaTicketCursor++];
          return {
            orderId: order.id,
            source: order.source,
            customerName: order.customerName,
            customerEmail: order.email,
            attendeeName: orderSeat.attendeeName || order.customerName,
            showTitle: order.performance.title || order.performance.show.title,
            startsAt: order.performance.startsAt,
            venue: order.performance.venue,
            sectionName: isGeneralAdmission ? 'General Admission' : orderSeat.seat?.sectionName || 'Unassigned Seat',
            row: isGeneralAdmission ? 'GA' : orderSeat.seat?.row || '',
            number: isGeneralAdmission ? index + 1 : orderSeat.seat?.number || index + 1,
            ticketType: orderSeat.ticketType,
            isComplimentary: orderSeat.isComplimentary,
            ticketPublicId: matchedTicket?.publicId || null,
            purchasedAt: order.createdAt
          };
        });
      });

      const filtered = query.q
        ? rows.filter((row) => {
            const needle = query.q!.toLowerCase();
            return (
              row.customerName.toLowerCase().includes(needle) ||
              row.customerEmail.toLowerCase().includes(needle) ||
              row.attendeeName.toLowerCase().includes(needle) ||
              row.orderId.toLowerCase().includes(needle)
            );
          })
        : rows;

      reply.send(filtered);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch roster');
    }
  });
};
