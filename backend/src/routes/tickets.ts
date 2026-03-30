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
              },
              orderSeats: {
                orderBy: {
                  createdAt: 'asc'
                }
              },
              tickets: {
                select: {
                  id: true,
                  seatId: true
                },
                orderBy: {
                  createdAt: 'asc'
                }
              }
            }
          }
        }
      });

      if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
      }

      const isGeneralAdmission = ticket.order.performance.seatSelectionEnabled === false;
      const ticketIndex = ticket.order.tickets.findIndex((candidate) => candidate.id === ticket.id);
      const orderSeat =
        (ticket.seatId ? ticket.order.orderSeats.find((candidate) => candidate.seatId === ticket.seatId) : null) ||
        (ticketIndex >= 0 ? ticket.order.orderSeats[ticketIndex] : null);

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
          id: ticket.seat?.id || null,
          sectionName: isGeneralAdmission ? 'General Admission' : ticket.seat?.sectionName || 'Unassigned Seat',
          row: isGeneralAdmission ? 'GA' : ticket.seat?.row || '',
          number: isGeneralAdmission ? (ticketIndex >= 0 ? ticketIndex + 1 : 1) : ticket.seat?.number || 1,
          isGeneralAdmission
        },
        holder: {
          customerName: ticket.order.customerName,
          customerEmail: ticket.order.email,
          customerPhone: ticket.order.customerPhone,
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
