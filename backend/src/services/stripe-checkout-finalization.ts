import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { buildQrPayload } from '../lib/qr.js';
import { sendTicketsEmail } from '../lib/email.js';
import { finalizeStudentCreditForOrderTx } from './student-ticket-credit-service.js';

export async function finalizeCheckoutSession(session: Stripe.Checkout.Session): Promise<{ newlyPaid: boolean }> {
  const metadata = session.metadata || {};
  const orderId = metadata.orderId;
  const performanceId = metadata.performanceId;
  const seatIds = JSON.parse(metadata.seatIds || '[]') as string[];

  if (!orderId || !performanceId || !Array.isArray(seatIds)) {
    throw new HttpError(400, 'Missing checkout metadata');
  }

  const newlyPaid = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      return false;
    }

    if (order.performanceId !== performanceId) {
      throw new HttpError(400, 'Performance mismatch in checkout completion');
    }

    const metadataSeatIds = [...new Set(seatIds)].sort();
    const orderSeatIds = order.orderSeats.map((s) => s.seatId).sort();
    const requestedSeatIds = orderSeatIds.length > 0 ? orderSeatIds : metadataSeatIds;

    if (
      orderSeatIds.length > 0 &&
      (orderSeatIds.length !== metadataSeatIds.length || orderSeatIds.join(',') !== metadataSeatIds.join(','))
    ) {
      throw new HttpError(400, 'Seat mismatch in checkout completion');
    }

    const seatUpdate = await tx.seat.updateMany({
      where: {
        id: { in: requestedSeatIds },
        performanceId,
        status: { in: ['HELD', 'AVAILABLE'] }
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

    const orderSeatPricingBySeatId = new Map(
      order.orderSeats.map((orderSeat) => [
        orderSeat.seatId,
        {
          price: orderSeat.price,
          isComplimentary: orderSeat.isComplimentary
        }
      ])
    );
    if (order.orderSeats.length === 0) {
      seats.forEach((seat) => {
        orderSeatPricingBySeatId.set(seat.id, {
          price: seat.price,
          isComplimentary: false
        });
      });
    }

    if (order.tickets.length === 0) {
      let firstTeacherCompTicketId: string | null = null;

      for (const seat of seats) {
        const orderSeat = orderSeatPricingBySeatId.get(seat.id);
        const ticketId = crypto.randomUUID();
        const qrSecret = crypto.randomBytes(16).toString('hex');
        const ticketType =
          order.source === 'STAFF_FREE'
            ? 'STAFF_COMP'
            : order.source === 'STAFF_COMP' && Boolean(orderSeat?.isComplimentary)
              ? 'STAFF_COMP'
              : order.source === 'STUDENT_COMP' && Boolean(orderSeat?.isComplimentary)
                ? 'STUDENT_COMP'
                : 'PAID';

        await tx.ticket.create({
          data: {
            id: ticketId,
            orderId: order.id,
            performanceId,
            userId: order.userId,
            seatId: seat.id,
            type: ticketType,
            priceCents: orderSeat?.price ?? seat.price,
            status: 'ISSUED',
            publicId: crypto.randomBytes(8).toString('hex'),
            qrSecret,
            qrPayload: buildQrPayload(ticketId, qrSecret)
          }
        });

        if (order.source === 'STAFF_COMP' && Boolean(orderSeat?.isComplimentary) && !firstTeacherCompTicketId) {
          firstTeacherCompTicketId = ticketId;
        }
      }

      if (order.source === 'STAFF_COMP' && order.userId) {
        if (!firstTeacherCompTicketId) {
          throw new HttpError(400, 'Teacher checkout requires at least one complimentary teacher ticket');
        }

        await tx.staffCompRedemption.create({
          data: {
            performanceId,
            userId: order.userId,
            ticketId: firstTeacherCompTicketId
          }
        });
      }
    }

    await finalizeStudentCreditForOrderTx(tx, {
      id: order.id,
      source: order.source,
      performanceId: order.performanceId,
      studentTicketCreditId: order.studentTicketCreditId,
      studentCreditPendingQuantity: order.studentCreditPendingQuantity,
      studentCreditVerificationMethod: order.studentCreditVerificationMethod
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        amountTotal,
        stripeSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null
      }
    });

    await tx.seatHold.deleteMany({ where: { seatId: { in: requestedSeatIds } } });

    return true;
  });

  if (!newlyPaid) {
    return { newlyPaid: false };
  }

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
