import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { buildQrPayload } from '../lib/qr.js';
import { sendTicketsEmail } from '../lib/email.js';
import { releaseHoldByToken } from '../services/hold-service.js';

async function finalizeCheckoutSession(session: Stripe.Checkout.Session): Promise<{ newlyPaid: boolean }> {
  const metadata = session.metadata || {};
  const orderId = metadata.orderId;
  const performanceId = metadata.performanceId;
  const holdToken = metadata.holdToken;
  const clientToken = metadata.clientToken;
  const seatIds = JSON.parse(metadata.seatIds || '[]') as string[];

  if (!orderId || !performanceId || !holdToken || !clientToken || !Array.isArray(seatIds)) {
    throw new HttpError(400, 'Missing checkout metadata');
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        orderSeats: true,
        tickets: true
      }
    });

    if (!order) {
      throw new HttpError(404, 'Order not found for checkout session');
    }

    if (order.status === 'PAID') {
      return;
    }

    const holdSession = await tx.holdSession.findUnique({
      where: { holdToken },
      include: {
        seatHolds: {
          select: { seatId: true }
        }
      }
    });

    if (!holdSession || holdSession.performanceId !== performanceId || holdSession.clientToken !== clientToken) {
      throw new HttpError(400, 'Invalid hold session for checkout completion');
    }

    if (holdSession.status !== 'ACTIVE' || holdSession.expiresAt < new Date()) {
      throw new HttpError(400, 'Hold expired before checkout completion');
    }

    const holdSeatIds = holdSession.seatHolds.map((s) => s.seatId).sort();
    const requestedSeatIds = [...new Set(seatIds)].sort();

    if (holdSeatIds.length !== requestedSeatIds.length || holdSeatIds.join(',') !== requestedSeatIds.join(',')) {
      throw new HttpError(400, 'Seat mismatch in checkout completion');
    }

    const seatUpdate = await tx.seat.updateMany({
      where: {
        id: { in: requestedSeatIds },
        performanceId,
        status: 'HELD',
        holdSessionId: holdSession.id
      },
      data: {
        status: 'SOLD',
        holdSessionId: null
      }
    });

    if (seatUpdate.count !== requestedSeatIds.length) {
      throw new HttpError(409, 'Unable to finalize one or more seats');
    }

    const seats = await tx.seat.findMany({
      where: { id: { in: requestedSeatIds } }
    });

    const amountTotal =
      order.orderSeats.length > 0
        ? order.orderSeats.reduce((sum, orderSeat) => sum + orderSeat.price, 0)
        : seats.reduce((sum, seat) => sum + seat.price, 0);

    if (order.orderSeats.length === 0) {
      await tx.orderSeat.createMany({
        data: seats.map((seat) => ({
          orderId: order.id,
          seatId: seat.id,
          price: seat.price,
          ticketType: null
        }))
      });
    }

    if (order.tickets.length === 0) {
      const orderSeatPriceBySeatId = new Map(order.orderSeats.map((seat) => [seat.seatId, seat.price]));
      for (const seat of seats) {
        const ticketId = crypto.randomUUID();
        const qrSecret = crypto.randomBytes(16).toString('hex');
        await tx.ticket.create({
          data: {
            id: ticketId,
            orderId: order.id,
            performanceId,
            userId: order.userId,
            seatId: seat.id,
            type: 'PAID',
            priceCents: orderSeatPriceBySeatId.get(seat.id) ?? seat.price,
            status: 'ISSUED',
            publicId: crypto.randomBytes(8).toString('hex'),
            qrSecret,
            qrPayload: buildQrPayload(ticketId, qrSecret)
          }
        });
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        amountTotal,
        stripeSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null
      }
    });

    await tx.seatHold.deleteMany({ where: { holdSessionId: holdSession.id } });
    await tx.holdSession.update({
      where: { id: holdSession.id },
      data: {
        status: 'CONVERTED'
      }
    });
  });

  const paidOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      performance: {
        include: {
          show: true
        }
      },
      tickets: {
        include: {
          seat: true
        }
      },
      orderSeats: true
    }
  });

  if (!paidOrder) {
    return { newlyPaid: false };
  }

  const orderSeatBySeatId = new Map(paidOrder.orderSeats.map((seat) => [seat.seatId, seat]));

  try {
    await sendTicketsEmail({
      orderId: paidOrder.id,
      customerName: paidOrder.customerName,
      customerEmail: paidOrder.email,
      showTitle: paidOrder.performance.title || paidOrder.performance.show.title,
      startsAtIso: paidOrder.performance.startsAt.toISOString(),
      venue: paidOrder.performance.venue,
      tickets: paidOrder.tickets.map((ticket) => ({
        publicId: ticket.publicId,
        row: ticket.seat.row,
        number: ticket.seat.number,
        sectionName: ticket.seat.sectionName,
        ticketType: orderSeatBySeatId.get(ticket.seatId)?.ticketType || null,
        attendeeName: orderSeatBySeatId.get(ticket.seatId)?.attendeeName || null
      }))
    });
  } catch (err) {
    console.error('Ticket email send failed', err);
  }

  return { newlyPaid: true };
}

export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/webhooks/stripe',
    {
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (!signature || Array.isArray(signature)) {
        return reply.status(400).send({ error: 'Missing stripe signature' });
      }

      try {
        const event = stripe.webhooks.constructEvent(
          (request as any).rawBody,
          signature,
          env.STRIPE_WEBHOOK_SECRET
        );

        switch (event.type) {
          case 'checkout.session.completed': {
            await finalizeCheckoutSession(event.data.object as Stripe.Checkout.Session);
            break;
          }
          case 'payment_intent.payment_failed': {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            const orderId = paymentIntent.metadata?.orderId;
            const holdToken = paymentIntent.metadata?.holdToken;

            if (orderId) {
              await prisma.order.updateMany({
                where: { id: orderId, status: 'PENDING' },
                data: { status: 'CANCELED' }
              });
            }

            if (holdToken) {
              await releaseHoldByToken(holdToken);
            }
            break;
          }
          case 'charge.refunded': {
            const charge = event.data.object as Stripe.Charge;
            if (typeof charge.payment_intent === 'string') {
              await prisma.order.updateMany({
                where: { stripePaymentIntentId: charge.payment_intent },
                data: { status: 'REFUNDED' }
              });
            }
            break;
          }
          default:
            break;
        }

        reply.send({ received: true });
      } catch (err) {
        handleRouteError(reply, err, 'Stripe webhook handling failed');
      }
    }
  );
};
