import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { finalizeCheckoutSession } from '../services/stripe-checkout-finalization.js';

const lookupSchema = z.object({
  orderId: z.string().min(1),
  email: z.string().email()
});

function serializeOrder(order: any) {
  const ticketBySeat = new Map<
    string,
    {
      id: string;
      publicId: string;
      qrPayload: string;
    }
  >(
    order.tickets.map((ticket: any) => [
      ticket.seatId,
      {
        id: ticket.id,
        publicId: ticket.publicId,
        qrPayload: ticket.qrPayload
      }
    ])
  );

  return {
    order: {
      id: order.id,
      status: order.status,
      source: order.source,
      email: order.email,
      customerName: order.customerName,
      amountTotal: order.amountTotal,
      currency: order.currency,
      createdAt: order.createdAt,
      performanceId: order.performanceId
    },
    performance: {
      id: order.performance.id,
      title: order.performance.title || order.performance.show.title,
      startsAt: order.performance.startsAt,
      venue: order.performance.venue,
      showTitle: order.performance.show.title
    },
    tickets: order.orderSeats.map((orderSeat: any) => {
      const ticket = ticketBySeat.get(orderSeat.seatId);
      return {
        id: ticket?.id,
        publicId: ticket?.publicId,
        seatId: orderSeat.seatId,
        sectionName: orderSeat.seat.sectionName,
        row: orderSeat.seat.row,
        number: orderSeat.seat.number,
        price: orderSeat.price,
        ticketType: orderSeat.ticketType,
        isComplimentary: orderSeat.isComplimentary,
        attendeeName: orderSeat.attendeeName,
        qrPayload: ticket?.qrPayload
      };
    })
  };
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  const reconcilePendingStripeOrder = async (order: { status: string; stripeSessionId: string | null }) => {
    if (order.status !== 'PENDING' || !order.stripeSessionId) return;

    try {
      const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
      if (session.status === 'complete' && session.payment_status === 'paid') {
        await finalizeCheckoutSession(session as Stripe.Checkout.Session);
      }
    } catch (err) {
      app.log.warn(err, `Order reconciliation failed for stripe session ${order.stripeSessionId}`);
    }
  };

  app.get('/api/orders/:orderId', async (request, reply) => {
    const params = request.params as { orderId: string };

    try {
      let order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          performance: { include: { show: true } },
          orderSeats: { include: { seat: true } },
          tickets: true
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      await reconcilePendingStripeOrder(order);

      if (order.status === 'PENDING' && order.stripeSessionId) {
        order = await prisma.order.findUnique({
          where: { id: params.orderId },
          include: {
            performance: { include: { show: true } },
            orderSeats: { include: { seat: true } },
            tickets: true
          }
        });
      }

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      reply.send(serializeOrder(order));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch order');
    }
  });

  app.post('/api/orders/lookup', async (request, reply) => {
    const parsed = lookupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      let order = await prisma.order.findFirst({
        where: {
          id: parsed.data.orderId,
          email: parsed.data.email.toLowerCase()
        },
        include: {
          performance: { include: { show: true } },
          orderSeats: { include: { seat: true } },
          tickets: true
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      await reconcilePendingStripeOrder(order);

      if (order.status === 'PENDING' && order.stripeSessionId) {
        order = await prisma.order.findFirst({
          where: {
            id: parsed.data.orderId,
            email: parsed.data.email.toLowerCase()
          },
          include: {
            performance: { include: { show: true } },
            orderSeats: { include: { seat: true } },
            tickets: true
          }
        });
      }

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      reply.send(serializeOrder(order));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to lookup order');
    }
  });
};
