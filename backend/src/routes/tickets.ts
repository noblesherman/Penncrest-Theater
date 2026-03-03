import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';

export const ticketRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/tickets/:publicId', async (request, reply) => {
    const params = request.params as { publicId: string };

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { publicId: params.publicId },
        include: {
          seat: true,
          order: {
            include: {
              performance: {
                include: {
                  show: true
                }
              }
            }
          }
        }
      });

      if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
      }

      const orderSeat = await prisma.orderSeat.findFirst({
        where: {
          orderId: ticket.orderId,
          seatId: ticket.seatId
        }
      });

      reply.send({
        id: ticket.id,
        publicId: ticket.publicId,
        qrPayload: ticket.qrPayload,
        createdAt: ticket.createdAt,
        performance: {
          id: ticket.order.performance.id,
          title: ticket.order.performance.title || ticket.order.performance.show.title,
          startsAt: ticket.order.performance.startsAt,
          venue: ticket.order.performance.venue,
          showTitle: ticket.order.performance.show.title
        },
        seat: {
          id: ticket.seat.id,
          sectionName: ticket.seat.sectionName,
          row: ticket.seat.row,
          number: ticket.seat.number
        },
        holder: {
          customerName: ticket.order.customerName,
          customerEmail: ticket.order.email,
          source: ticket.order.source,
          ticketType: orderSeat?.ticketType || null,
          attendeeName: orderSeat?.attendeeName || null
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch ticket');
    }
  });
};
