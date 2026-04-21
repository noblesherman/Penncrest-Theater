import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { buildQrPayload } from '../lib/qr.js';
import { sendTicketsEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-log.js';
import { finalizeStudentCreditForOrderTx } from './student-ticket-credit-service.js';
import { requestStripeRefundForOrder } from './order-refund-service.js';

type FinalizeOutcome = 'paid' | 'already_paid' | 'finalization_failed';

export type FinalizeCheckoutResult = {
  outcome: FinalizeOutcome;
  newlyPaid: boolean;
  refundOutcome?: 'already_refunded' | 'already_requested' | 'succeeded' | 'pending' | 'failed';
};

type FinalizableOrder = Prisma.OrderGetPayload<{
  include: {
    orderSeats: true;
    tickets: true;
    performance: {
      select: {
        seatSelectionEnabled: true;
      };
    };
  };
}>;

type FinalizationContext = {
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  actor: 'stripe_webhook' | 'order_lookup_reconcile';
};

function sortByCreatedAtThenId<T extends { createdAt: Date; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

function parsePaymentMetadata(metadata: Record<string, string | undefined> | null | undefined): {
  orderId: string;
  performanceId: string;
  seatIds: string[];
} {
  const orderId = metadata?.orderId;
  const performanceId = metadata?.performanceId;
  let seatIds: string[] = [];

  try {
    seatIds = JSON.parse(metadata?.seatIds || '[]') as string[];
  } catch {
    seatIds = [];
  }

  if (!orderId || !performanceId || !Array.isArray(seatIds)) {
    throw new HttpError(400, 'Missing checkout metadata');
  }

  return {
    orderId,
    performanceId,
    seatIds: [...new Set(seatIds)]
  };
}

async function getHoldSessionIdForOrder(
  tx: Prisma.TransactionClient,
  holdToken: string | null
): Promise<string | null> {
  if (!holdToken) {
    return null;
  }

  const hold = await tx.holdSession.findUnique({
    where: { holdToken },
    select: { id: true }
  });

  return hold?.id || null;
}

function resolveRequestedSeatIds(order: FinalizableOrder, metadataSeatIds: string[]): string[] {
  const orderSeatIds = order.orderSeats
    .map((seat) => seat.seatId)
    .filter((seatId): seatId is string => Boolean(seatId))
    .sort();
  const normalizedMetadataSeatIds = [...metadataSeatIds].sort();

  if (orderSeatIds.length > 0) {
    if (normalizedMetadataSeatIds.length === 0) {
      return orderSeatIds;
    }

    if (
      orderSeatIds.length !== normalizedMetadataSeatIds.length ||
      orderSeatIds.join(',') !== normalizedMetadataSeatIds.join(',')
    ) {
      throw new HttpError(400, 'Seat mismatch in checkout completion');
    }

    return orderSeatIds;
  }

  return normalizedMetadataSeatIds;
}

async function createMissingTickets(
  tx: Prisma.TransactionClient,
  order: FinalizableOrder,
  isGeneralAdmissionNoSeatLinks: boolean,
  seats: Array<{
    id: string;
    price: number;
  }>,
  orderSeats: Array<{
    id: string;
    seatId: string | null;
    price: number;
    isComplimentary: boolean;
    createdAt: Date;
  }>
): Promise<void> {
  const sortedOrderSeats = sortByCreatedAtThenId(orderSeats);
  const sortedExistingTickets = sortByCreatedAtThenId(order.tickets);
  const existingTicketSeatIds = new Set(
    sortedExistingTickets
      .map((ticket) => ticket.seatId)
      .filter((seatId): seatId is string => Boolean(seatId))
  );
  let firstTeacherCompTicketId = sortedExistingTickets.find((ticket) => ticket.type === 'STAFF_COMP')?.id || null;

  if (isGeneralAdmissionNoSeatLinks) {
    for (let index = sortedExistingTickets.length; index < sortedOrderSeats.length; index += 1) {
      const orderSeat = sortedOrderSeats[index];
      if (!orderSeat) break;

      const ticketId = crypto.randomUUID();
      const qrSecret = crypto.randomBytes(16).toString('hex');
      const ticketType =
        order.source === 'STAFF_FREE'
          ? 'STAFF_COMP'
          : order.source === 'STAFF_COMP' && orderSeat.isComplimentary
            ? 'STAFF_COMP'
            : order.source === 'STUDENT_COMP' && orderSeat.isComplimentary
              ? 'STUDENT_COMP'
              : 'PAID';

      await tx.ticket.create({
        data: {
          id: ticketId,
          orderId: order.id,
          performanceId: order.performanceId,
          userId: order.userId,
          seatId: orderSeat.seatId,
          type: ticketType,
          priceCents: orderSeat.price,
          status: 'ISSUED',
          publicId: crypto.randomBytes(8).toString('hex'),
          qrSecret,
          qrPayload: buildQrPayload(ticketId, qrSecret)
        }
      });

      if (order.source === 'STAFF_COMP' && orderSeat.isComplimentary && !firstTeacherCompTicketId) {
        firstTeacherCompTicketId = ticketId;
      }
    }
  } else {
    const orderSeatBySeatId = new Map(
      sortedOrderSeats
        .filter((orderSeat) => Boolean(orderSeat.seatId))
        .map((orderSeat) => [orderSeat.seatId as string, orderSeat])
    );

    for (const seat of seats) {
      if (existingTicketSeatIds.has(seat.id)) {
        continue;
      }

      const orderSeat = orderSeatBySeatId.get(seat.id);
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
          performanceId: order.performanceId,
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
  }

  if (order.source === 'STAFF_COMP' && order.userId) {
    const redemptionExists = await tx.staffCompRedemption.findFirst({
      where: {
        performanceId: order.performanceId,
        userId: order.userId
      },
      select: { id: true }
    });

    if (!redemptionExists) {
      if (!firstTeacherCompTicketId) {
        throw new HttpError(400, 'Teacher checkout requires at least one complimentary teacher ticket');
      }

      await tx.staffCompRedemption.create({
        data: {
          performanceId: order.performanceId,
          userId: order.userId,
          ticketId: firstTeacherCompTicketId
        }
      });
    }
  }
}

async function finalizePaidOrderTx(
  tx: Prisma.TransactionClient,
  context: FinalizationContext,
  order: FinalizableOrder,
  performanceId: string,
  requestedSeatIds: string[]
): Promise<void> {
  if (order.performanceId !== performanceId) {
    throw new HttpError(400, 'Performance mismatch in checkout completion');
  }

  const isGeneralAdmissionNoSeatLinks = order.performance.seatSelectionEnabled === false;
  const holdSessionId = await getHoldSessionIdForOrder(tx, order.holdToken || null);
  let effectiveRequestedSeatIds = requestedSeatIds;
  if (effectiveRequestedSeatIds.length === 0 && holdSessionId) {
    const heldSeats = await tx.seatHold.findMany({
      where: { holdSessionId },
      select: { seatId: true }
    });
    effectiveRequestedSeatIds = heldSeats.map((seat) => seat.seatId);
  }

  if (effectiveRequestedSeatIds.length === 0) {
    throw new HttpError(400, 'We could not resolve seats for checkout completion');
  }

  const seats = await tx.seat.findMany({
    where: {
      id: { in: effectiveRequestedSeatIds },
      performanceId
    }
  });

  if (seats.length !== effectiveRequestedSeatIds.length) {
    throw new HttpError(400, 'We could not load seats for checkout completion');
  }

  const existingTicketSeatIds = new Set(
    order.tickets
      .map((ticket) => ticket.seatId)
      .filter((seatId): seatId is string => Boolean(seatId))
  );
  const conflictingSeat = seats.find((seat) => {
    if (seat.status === 'BLOCKED') {
      return true;
    }

    if (seat.status === 'HELD') {
      return seat.holdSessionId !== holdSessionId;
    }

    if (seat.status === 'SOLD') {
      return !existingTicketSeatIds.has(seat.id);
    }

    return false;
  });

  if (conflictingSeat) {
    throw new HttpError(409, 'We could not finalize one or more seats');
  }

  const seatsToSell = seats.filter((seat) => seat.status !== 'SOLD').map((seat) => seat.id);
  if (seatsToSell.length > 0) {
    const seatUpdate = await tx.seat.updateMany({
      where: {
        id: { in: seatsToSell },
        performanceId,
        OR: [
          {
            status: 'AVAILABLE'
          },
          ...(holdSessionId
            ? [
                {
                  status: 'HELD',
                  holdSessionId
                } as const
              ]
            : [])
        ]
      },
      data: {
        status: 'SOLD',
        holdSessionId: null
      }
    });

    if (seatUpdate.count !== seatsToSell.length) {
      throw new HttpError(409, 'We could not finalize one or more seats');
    }
  }

  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const orderedSeats = effectiveRequestedSeatIds
    .map((seatId) => seatById.get(seatId))
    .filter((seat): seat is NonNullable<typeof seat> => Boolean(seat));
  let refreshedOrderSeats = order.orderSeats;

  if (isGeneralAdmissionNoSeatLinks) {
    if (refreshedOrderSeats.length === 0) {
      await tx.orderSeat.createMany({
        data: orderedSeats.map((seat) => ({
          orderId: order.id,
          seatId: null,
          price: seat.price,
          ticketType: null
        }))
      });

      refreshedOrderSeats = await tx.orderSeat.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' }
      });
    }

    if (refreshedOrderSeats.length !== orderedSeats.length) {
      throw new HttpError(400, 'Ticket quantity mismatch in checkout completion');
    }
  } else {
    const orderSeatIds = new Set(
      order.orderSeats
        .map((seat) => seat.seatId)
        .filter((seatId): seatId is string => Boolean(seatId))
    );
    const missingOrderSeatRows = orderedSeats.filter((seat) => !orderSeatIds.has(seat.id));
    if (missingOrderSeatRows.length > 0) {
      await tx.orderSeat.createMany({
        data: missingOrderSeatRows.map((seat) => ({
          orderId: order.id,
          seatId: seat.id,
          price: seat.price,
          ticketType: null
        }))
      });
    }

    if (missingOrderSeatRows.length > 0) {
      refreshedOrderSeats = await tx.orderSeat.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' }
      });
    }
  }

  const amountTotal = refreshedOrderSeats.reduce((sum, orderSeat) => sum + orderSeat.price, 0);
  await createMissingTickets(tx, order, isGeneralAdmissionNoSeatLinks, orderedSeats, refreshedOrderSeats);

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
      checkoutAttemptState: 'NONE',
      checkoutAttemptExpiresAt: null,
      amountTotal,
      stripeSessionId: context.stripeSessionId,
      stripePaymentIntentId: context.stripePaymentIntentId,
      finalizationAttemptCount: {
        increment: 1
      },
      finalizationFailedAt: null,
      lastFinalizationError: null,
      lastRefundError: null
    }
  });

  await tx.seatHold.deleteMany({
    where: {
      seatId: { in: effectiveRequestedSeatIds }
    }
  });
}

async function sendTicketsEmailForOrder(orderId: string): Promise<void> {
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
        },
        orderBy: {
          createdAt: 'asc'
        }
      },
      orderSeats: {
        orderBy: {
          createdAt: 'asc'
        }
      }
    }
  });

  if (!paidOrder) {
    return;
  }

  const isGeneralAdmission = paidOrder.performance.seatSelectionEnabled === false;
  const orderSeatBySeatId = new Map(
    paidOrder.orderSeats
      .filter((seat) => Boolean(seat.seatId))
      .map((seat) => [seat.seatId as string, seat])
  );
  const generalAdmissionOrderSeats = paidOrder.orderSeats.filter((seat) => !seat.seatId);
  let generalAdmissionSeatCursor = 0;

  try {
    await sendTicketsEmail({
      orderId: paidOrder.id,
      orderAccessToken: paidOrder.accessToken,
      customerName: paidOrder.customerName,
      customerEmail: paidOrder.email,
      showTitle: paidOrder.performance.title || paidOrder.performance.show.title,
      startsAtIso: paidOrder.performance.startsAt.toISOString(),
      venue: paidOrder.performance.venue,
      tickets: paidOrder.tickets.map((ticket, index) => {
        const matchedOrderSeat =
          (ticket.seatId ? orderSeatBySeatId.get(ticket.seatId) : null) ||
          generalAdmissionOrderSeats[generalAdmissionSeatCursor++] ||
          paidOrder.orderSeats[index];
        return {
          publicId: ticket.publicId,
          row: isGeneralAdmission ? '' : ticket.seat?.row || '',
          number: isGeneralAdmission ? index + 1 : ticket.seat?.number || index + 1,
          sectionName: isGeneralAdmission ? 'General Admission' : ticket.seat?.sectionName || 'Unassigned Seat',
          seatLabel: isGeneralAdmission ? `General Admission Ticket ${index + 1}` : null,
          ticketType: matchedOrderSeat?.ticketType || null,
          attendeeName: matchedOrderSeat?.attendeeName || null
        };
      })
    });
  } catch (err) {
    console.error('Ticket email send failed', err);
  }
}

async function recordFinalizationFailure(
  db: PrismaClient,
  context: FinalizationContext,
  orderId: string,
  err: unknown
): Promise<FinalizeCheckoutResult> {
  const errorMessage = err instanceof HttpError ? err.message : 'Unexpected checkout finalization error';
  const paymentIntentId = context.stripePaymentIntentId;

  await db.order.updateMany({
    where: {
      id: orderId,
      status: {
        in: ['PENDING', 'FINALIZATION_FAILED']
      }
    },
    data: {
      status: 'FINALIZATION_FAILED',
      checkoutAttemptState: 'NONE',
      checkoutAttemptExpiresAt: null,
      stripeSessionId: context.stripeSessionId,
      stripePaymentIntentId: paymentIntentId,
      finalizationAttemptCount: {
        increment: 1
      },
      finalizationFailedAt: new Date(),
      lastFinalizationError: errorMessage
    }
  });

  await logAudit({
    actor: context.actor,
    action: 'ORDER_FINALIZATION_FAILED',
    entityType: 'Order',
    entityId: orderId,
    metadata: {
      stripeSessionId: context.stripeSessionId,
      stripePaymentIntentId: paymentIntentId,
      error: errorMessage
    }
  });

  try {
    const refundResult = await requestStripeRefundForOrder({
      orderId,
      requestedBy: 'stripe_webhook_finalization_failed',
      reason: 'Automatic refund after checkout finalization failed',
      fallbackPaymentIntentId: paymentIntentId,
      idempotencyKey: `order-finalization-failure:${orderId}`
    });

    await logAudit({
      actor: context.actor,
      action: 'ORDER_FINALIZATION_REFUND_REQUESTED',
      entityType: 'Order',
      entityId: orderId,
      metadata: {
        stripeSessionId: context.stripeSessionId,
        stripePaymentIntentId: paymentIntentId,
        refundId: refundResult.refundId,
        refundStatus: refundResult.refundStatus,
        refundOutcome: refundResult.outcome
      }
    });

    return {
      outcome: 'finalization_failed',
      newlyPaid: false,
      refundOutcome: refundResult.outcome
    };
  } catch (refundErr) {
    await logAudit({
      actor: context.actor,
      action: 'ORDER_FINALIZATION_REFUND_FAILED',
      entityType: 'Order',
      entityId: orderId,
      metadata: {
        stripeSessionId: context.stripeSessionId,
        stripePaymentIntentId: paymentIntentId,
        error: refundErr instanceof Error ? refundErr.message : 'Refund request failed'
      }
    });

    return {
      outcome: 'finalization_failed',
      newlyPaid: false,
      refundOutcome: 'failed'
    };
  }
}

async function finalizeByMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
  context: FinalizationContext
): Promise<FinalizeCheckoutResult> {
  const { orderId, performanceId, seatIds } = parsePaymentMetadata(metadata);

  try {
    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          orderSeats: true,
          tickets: true,
          performance: {
            select: {
              seatSelectionEnabled: true
            }
          }
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found for checkout session');
      }

      if (order.status === 'PAID') {
        return 'already_paid' as const;
      }

      if (order.status === 'REFUNDED') {
        return 'finalization_failed' as const;
      }

      if (order.status === 'CANCELED') {
        throw new HttpError(409, 'Checkout attempt is no longer active');
      }

      const refundStatus = order.stripeRefundStatus?.toLowerCase();
      if (
        order.status === 'FINALIZATION_FAILED' &&
        refundStatus &&
        !['failed', 'canceled'].includes(refundStatus)
      ) {
        return 'finalization_failed' as const;
      }

      const requestedSeatIds = resolveRequestedSeatIds(order, seatIds);
      await finalizePaidOrderTx(tx, context, order, performanceId, requestedSeatIds);
      return 'paid' as const;
    });

    if (outcome !== 'paid') {
      return {
        outcome,
        newlyPaid: false
      };
    }

    await sendTicketsEmailForOrder(orderId);

    return {
      outcome: 'paid',
      newlyPaid: true
    };
  } catch (err) {
    return recordFinalizationFailure(prisma, context, orderId, err);
  }
}

export async function finalizeCheckoutSession(session: Stripe.Checkout.Session): Promise<FinalizeCheckoutResult> {
  const context: FinalizationContext = {
    stripeSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    actor: 'stripe_webhook'
  };
  return finalizeByMetadata(session.metadata, context);
}

export async function finalizePaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  actor: FinalizationContext['actor'] = 'stripe_webhook'
): Promise<FinalizeCheckoutResult> {
  const context: FinalizationContext = {
    stripeSessionId: null,
    stripePaymentIntentId: paymentIntent.id,
    actor
  };
  return finalizeByMetadata(paymentIntent.metadata, context);
}
