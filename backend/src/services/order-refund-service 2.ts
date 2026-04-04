import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { HttpError } from '../lib/http-error.js';
import { restoreStudentCreditsForRefundTx } from './student-ticket-credit-service.js';

type RefundRequestParams = {
  orderId: string;
  requestedBy: string;
  reason?: string;
  idempotencyKey: string;
  fallbackPaymentIntentId?: string | null;
};

type RefundResult = {
  outcome: 'already_refunded' | 'already_requested' | 'succeeded' | 'pending' | 'failed';
  refundId: string | null;
  refundStatus: string | null;
  amount: number;
};

function normalizeRefundStatus(status: string | null | undefined): string | null {
  return status?.toLowerCase() || null;
}

async function markRefundState(params: {
  orderId: string;
  refundId?: string | null;
  refundStatus?: string | null;
  amount?: number;
  requestedAt?: Date | null;
  refundedAt?: Date | null;
  lastRefundError?: string | null;
  releaseSeatsOnRefund?: boolean;
}): Promise<void> {
  await prisma.order.update({
    where: { id: params.orderId },
    data: {
      stripeRefundId: params.refundId ?? undefined,
      stripeRefundStatus: params.refundStatus ?? undefined,
      refundAmountCents: typeof params.amount === 'number' ? params.amount : undefined,
      refundRequestedAt: params.requestedAt ?? undefined,
      refundedAt: params.refundedAt ?? undefined,
      lastRefundError: params.lastRefundError ?? undefined,
      releaseSeatsOnRefund:
        typeof params.releaseSeatsOnRefund === 'boolean' ? params.releaseSeatsOnRefund : undefined
    }
  });
}

export async function applySuccessfulRefundToOrder(params: {
  orderId: string;
  amount: number;
  refundId?: string | null;
  refundStatus?: string | null;
  refundedAt?: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: {
        orderSeats: {
          select: {
            seatId: true
          }
        }
      }
    });

    if (!order) {
      throw new HttpError(404, 'Order not found');
    }

    const fullyRefunded = params.amount >= order.amountTotal;

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: fullyRefunded ? 'REFUNDED' : order.status,
        stripeRefundId: params.refundId ?? order.stripeRefundId,
        stripeRefundStatus: params.refundStatus ?? 'succeeded',
        refundAmountCents: params.amount,
        refundRequestedAt: order.refundRequestedAt || params.refundedAt || new Date(),
        refundedAt: params.refundedAt || new Date(),
        lastRefundError: null
      }
    });

    if (!fullyRefunded) {
      return;
    }

    await tx.ticket.updateMany({
      where: {
        orderId: order.id,
        status: 'ISSUED'
      },
      data: {
        status: 'CANCELLED'
      }
    });

    await restoreStudentCreditsForRefundTx(tx, {
      orderId: order.id,
      restoredBy: 'stripe_refund',
      notes: 'Stripe refund confirmed'
    });

    const soldSeatIds = order.orderSeats
      .map((seat) => seat.seatId)
      .filter((seatId): seatId is string => typeof seatId === 'string' && seatId.length > 0);

    if (soldSeatIds.length > 0) {
      await tx.seat.updateMany({
        where: {
          id: { in: soldSeatIds },
          status: 'SOLD'
        },
        data: {
          status: 'AVAILABLE',
          holdSessionId: null
        }
      });
    }
  });
}

export async function requestStripeRefundForOrder(params: RefundRequestParams): Promise<RefundResult> {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: {
      id: true,
      amountTotal: true,
      status: true,
      stripePaymentIntentId: true,
      stripeRefundId: true,
      stripeRefundStatus: true,
      releaseSeatsOnRefund: true
    }
  });

  if (!order) {
    throw new HttpError(404, 'Order not found');
  }

  if (order.status === 'REFUNDED' && normalizeRefundStatus(order.stripeRefundStatus) === 'succeeded') {
    return {
      outcome: 'already_refunded',
      refundId: order.stripeRefundId,
      refundStatus: order.stripeRefundStatus,
      amount: order.amountTotal
    };
  }

  const existingRefundStatus = normalizeRefundStatus(order.stripeRefundStatus);
  if (order.stripeRefundId && existingRefundStatus && !['failed', 'canceled'].includes(existingRefundStatus)) {
    return {
      outcome: existingRefundStatus === 'succeeded' ? 'already_refunded' : 'already_requested',
      refundId: order.stripeRefundId,
      refundStatus: order.stripeRefundStatus,
      amount: order.amountTotal
    };
  }

  const paymentIntentId = order.stripePaymentIntentId || params.fallbackPaymentIntentId;
  if (!paymentIntentId) {
    throw new HttpError(400, 'Order does not have a Stripe payment to refund');
  }

  if (!order.stripePaymentIntentId && params.fallbackPaymentIntentId) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        stripePaymentIntentId: params.fallbackPaymentIntentId
      }
    });
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        metadata: {
          orderId: order.id,
          requestedBy: params.requestedBy,
          releaseSeats: 'true',
          reason: params.reason || 'Refund requested'
        }
      },
      {
        idempotencyKey: params.idempotencyKey
      }
    );

    const refundStatus = normalizeRefundStatus(refund.status);
    const refundRequestedAt = new Date();

    await markRefundState({
      orderId: order.id,
      refundId: refund.id,
      refundStatus,
      amount: refund.amount,
      requestedAt: refundRequestedAt,
      refundedAt: refundStatus === 'succeeded' ? refundRequestedAt : null,
      lastRefundError: (refund as Stripe.Refund & { failure_reason?: string | null }).failure_reason || null,
      releaseSeatsOnRefund: true
    });

    if (refundStatus === 'succeeded') {
      await applySuccessfulRefundToOrder({
        orderId: order.id,
        amount: refund.amount,
        refundId: refund.id,
        refundStatus,
        refundedAt: refundRequestedAt
      });

      return {
        outcome: 'succeeded',
        refundId: refund.id,
        refundStatus,
        amount: refund.amount
      };
    }

    if (refundStatus === 'failed' || refundStatus === 'canceled') {
      return {
        outcome: 'failed',
        refundId: refund.id,
        refundStatus,
        amount: refund.amount
      };
    }

    return {
      outcome: 'pending',
      refundId: refund.id,
      refundStatus,
      amount: refund.amount
    };
  } catch (err) {
    const message =
      err instanceof Stripe.errors.StripeError ? err.message : err instanceof Error ? err.message : 'Refund failed';

    await markRefundState({
      orderId: order.id,
      refundStatus: 'failed',
      amount: order.amountTotal,
      requestedAt: new Date(),
      lastRefundError: message,
      releaseSeatsOnRefund: true
    });

    throw new HttpError(502, message);
  }
}

export async function syncRefundFromCharge(charge: Stripe.Charge): Promise<void> {
  if (typeof charge.payment_intent !== 'string') {
    return;
  }

  const orders = await prisma.order.findMany({
    where: {
      stripePaymentIntentId: charge.payment_intent
    },
    select: {
      id: true,
      amountTotal: true
    }
  });

  if (orders.length === 0) {
    return;
  }

  const refunds = charge.refunds?.data || [];
  const latestRefund = refunds.reduce<Stripe.Refund | null>((latest, refund) => {
    if (!latest) {
      return refund;
    }
    return refund.created > latest.created ? refund : latest;
  }, null);
  const normalizedStatus = latestRefund ? normalizeRefundStatus(latestRefund.status) : charge.refunded ? 'succeeded' : 'pending';
  const refundedAt = charge.refunded ? new Date(charge.created * 1000) : undefined;

  for (const order of orders) {
    await markRefundState({
      orderId: order.id,
      refundId: latestRefund?.id || null,
      refundStatus: normalizedStatus,
      amount: charge.amount_refunded,
      requestedAt: new Date(charge.created * 1000),
      refundedAt: charge.amount_refunded >= order.amountTotal ? refundedAt : null,
      lastRefundError: (latestRefund as Stripe.Refund & { failure_reason?: string | null } | null)?.failure_reason || null
    });

    if (charge.amount_refunded >= order.amountTotal) {
      await applySuccessfulRefundToOrder({
        orderId: order.id,
        amount: charge.amount_refunded,
        refundId: latestRefund?.id || null,
        refundStatus: normalizedStatus,
        refundedAt
      });
    }
  }
}
