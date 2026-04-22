/*
Handoff note for Mr. Smith:
- File: `backend/src/services/checkout-attempt-service.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { CheckoutAttemptState } from '@prisma/client';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { releaseHoldByToken } from './hold-service.js';
import { releasePendingStudentCreditForOrder } from './student-ticket-credit-service.js';

const ACTIVE_CHECKOUT_ATTEMPT_STATES: CheckoutAttemptState[] = [
  'CREATING_PAYMENT_INTENT',
  'AWAITING_PAYMENT',
  'FAILED'
];

export function getCheckoutAttemptExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + env.CHECKOUT_ATTEMPT_TTL_MINUTES * 60_000);
}

export async function markCheckoutAttemptAwaitingPayment(params: {
  orderId: string;
  stripePaymentIntentId: string;
}): Promise<void> {
  await prisma.order.update({
    where: { id: params.orderId },
    data: {
      stripePaymentIntentId: params.stripePaymentIntentId,
      checkoutAttemptState: 'AWAITING_PAYMENT'
    }
  });
}

export async function markCheckoutAttemptFailed(params: {
  orderId: string;
  stripePaymentIntentId?: string | null;
}): Promise<void> {
  await prisma.order.updateMany({
    where: {
      id: params.orderId,
      status: 'PENDING'
    },
    data: {
      stripePaymentIntentId: params.stripePaymentIntentId || undefined,
      checkoutAttemptState: 'FAILED'
    }
  });
}

export async function expirePendingCheckoutAttempt(orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      holdToken: true
    }
  });

  if (!order || order.status !== 'PENDING') {
    return false;
  }

  const updated = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: 'PENDING'
    },
    data: {
      status: 'CANCELED',
      checkoutAttemptState: 'EXPIRED',
      checkoutAttemptExpiresAt: null
    }
  });

  if (updated.count === 0) {
    return false;
  }

  await releasePendingStudentCreditForOrder(order.id).catch(() => undefined);
  if (order.holdToken) {
    await releaseHoldByToken(order.holdToken).catch(() => undefined);
  }

  return true;
}

export async function expireStalePendingCheckoutAttempts(now: Date = new Date()): Promise<number> {
  const staleOrders = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      checkoutAttemptState: {
        in: ACTIVE_CHECKOUT_ATTEMPT_STATES
      },
      checkoutAttemptExpiresAt: {
        lte: now
      }
    },
    select: {
      id: true
    }
  });

  let expired = 0;
  for (const order of staleOrders) {
    if (await expirePendingCheckoutAttempt(order.id)) {
      expired += 1;
    }
  }

  return expired;
}
