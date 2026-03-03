import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';

export const adminRosterRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/roster', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const query = request.query as {
      performanceId?: string;
      q?: string;
    };

    try {
      const orders = await prisma.order.findMany({
        where: {
          status: 'PAID',
          ...(query.performanceId ? { performanceId: query.performanceId } : {})
        },
        include: {
          performance: { include: { show: true } },
          orderSeats: { include: { seat: true } },
          tickets: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      const rows = orders.flatMap((order) => {
        const ticketBySeatId = new Map(order.tickets.map((ticket) => [ticket.seatId, ticket]));

        return order.orderSeats.map((orderSeat) => ({
          orderId: order.id,
          source: order.source,
          customerName: order.customerName,
          customerEmail: order.email,
          attendeeName: orderSeat.attendeeName || order.customerName,
          showTitle: order.performance.title || order.performance.show.title,
          startsAt: order.performance.startsAt,
          venue: order.performance.venue,
          sectionName: orderSeat.seat.sectionName,
          row: orderSeat.seat.row,
          number: orderSeat.seat.number,
          ticketType: orderSeat.ticketType,
          isComplimentary: orderSeat.isComplimentary,
          ticketPublicId: ticketBySeatId.get(orderSeat.seatId)?.publicId || null,
          purchasedAt: order.createdAt
        }));
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
