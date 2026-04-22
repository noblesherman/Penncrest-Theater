/*
Handoff note for Mr. Smith:
- File: `backend/src/services/trip-payment-finalization.ts`
- What this is: Backend domain service module.
- What it does: Implements core business logic used by routes, jobs, and workers.
- Connections: Called by route handlers and often integrates with Stripe + Prisma.
- Main content type: High-impact business logic and side effects.
- Safe edits here: Comments and conservative observability text updates.
- Be careful with: Side-effect ordering, idempotency, and money/ticket flow behavior.
- Useful context: When route shape looks right but outcomes are wrong, this layer is usually the cause.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';

type TripPaymentMetadata = {
  source: 'trip_payment';
  tripId: string;
  enrollmentId: string;
  accountId: string;
  studentId: string;
  tripPaymentId?: string;
};

function parseTripPaymentMetadata(metadata: Record<string, string | undefined> | null | undefined): TripPaymentMetadata | null {
  if (!metadata || metadata.source !== 'trip_payment') {
    return null;
  }

  if (!metadata.tripId || !metadata.enrollmentId || !metadata.accountId || !metadata.studentId) {
    throw new HttpError(400, 'Trip payment metadata missing required fields');
  }

  return {
    source: 'trip_payment',
    tripId: metadata.tripId,
    enrollmentId: metadata.enrollmentId,
    accountId: metadata.accountId,
    studentId: metadata.studentId,
    tripPaymentId: metadata.tripPaymentId || undefined
  };
}

async function finalizeTripPayment(params: {
  metadata: Record<string, string | undefined> | null | undefined;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  paidAt?: Date;
}): Promise<void> {
  const metadata = parseTripPaymentMetadata(params.metadata);
  if (!metadata) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    let payment = null;

    if (metadata.tripPaymentId) {
      payment = await tx.tripPayment.findUnique({
        where: {
          id: metadata.tripPaymentId
        },
        include: {
          enrollment: {
            select: {
              id: true,
              studentId: true,
              tripId: true
            }
          }
        }
      });
    }

    if (!payment && params.stripeCheckoutSessionId) {
      payment = await tx.tripPayment.findUnique({
        where: {
          stripeCheckoutSessionId: params.stripeCheckoutSessionId
        },
        include: {
          enrollment: {
            select: {
              id: true,
              studentId: true,
              tripId: true
            }
          }
        }
      });
    }

    if (!payment && params.stripePaymentIntentId) {
      payment = await tx.tripPayment.findUnique({
        where: {
          stripePaymentIntentId: params.stripePaymentIntentId
        },
        include: {
          enrollment: {
            select: {
              id: true,
              studentId: true,
              tripId: true
            }
          }
        }
      });
    }

    if (!payment) {
      throw new HttpError(404, 'Trip payment record not found for webhook event');
    }

    if (payment.enrollment.id !== metadata.enrollmentId || payment.enrollment.tripId !== metadata.tripId) {
      throw new HttpError(400, 'Trip payment enrollment metadata mismatch');
    }

    if (payment.accountId !== metadata.accountId || payment.enrollment.studentId !== metadata.studentId) {
      throw new HttpError(400, 'Trip payment account metadata mismatch');
    }

    if (payment.status === 'SUCCEEDED') {
      await tx.tripPayment.update({
        where: {
          id: payment.id
        },
        data: {
          stripeCheckoutSessionId: payment.stripeCheckoutSessionId || params.stripeCheckoutSessionId || undefined,
          stripePaymentIntentId: payment.stripePaymentIntentId || params.stripePaymentIntentId || undefined
        }
      });
      return;
    }

    await tx.tripPayment.update({
      where: {
        id: payment.id
      },
      data: {
        status: 'SUCCEEDED',
        paidAt: params.paidAt || new Date(),
        stripeCheckoutSessionId: payment.stripeCheckoutSessionId || params.stripeCheckoutSessionId || undefined,
        stripePaymentIntentId: payment.stripePaymentIntentId || params.stripePaymentIntentId || undefined
      }
    });
  });
}

async function markTripPaymentState(params: {
  metadata: Record<string, string | undefined> | null | undefined;
  nextStatus: 'FAILED' | 'EXPIRED';
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
}): Promise<void> {
  const metadata = parseTripPaymentMetadata(params.metadata);
  if (!metadata) {
    return;
  }

  const whereById = metadata.tripPaymentId
    ? {
        id: metadata.tripPaymentId
      }
    : null;

  if (whereById) {
    await prisma.tripPayment.updateMany({
      where: {
        ...whereById,
        status: {
          not: 'SUCCEEDED'
        }
      },
      data: {
        status: params.nextStatus,
        stripeCheckoutSessionId: params.stripeCheckoutSessionId || undefined,
        stripePaymentIntentId: params.stripePaymentIntentId || undefined
      }
    });
    return;
  }

  if (params.stripeCheckoutSessionId) {
    await prisma.tripPayment.updateMany({
      where: {
        stripeCheckoutSessionId: params.stripeCheckoutSessionId,
        status: {
          not: 'SUCCEEDED'
        }
      },
      data: {
        status: params.nextStatus,
        stripePaymentIntentId: params.stripePaymentIntentId || undefined
      }
    });
    return;
  }

  if (params.stripePaymentIntentId) {
    await prisma.tripPayment.updateMany({
      where: {
        stripePaymentIntentId: params.stripePaymentIntentId,
        status: {
          not: 'SUCCEEDED'
        }
      },
      data: {
        status: params.nextStatus
      }
    });
  }
}

export async function finalizeTripPaymentFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  await finalizeTripPayment({
    metadata: session.metadata,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    paidAt: new Date()
  });
}

export async function finalizeTripPaymentFromPaymentIntent(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  await finalizeTripPayment({
    metadata: paymentIntent.metadata,
    stripePaymentIntentId: paymentIntent.id,
    paidAt: new Date()
  });
}

export async function markTripPaymentFailedFromPaymentIntent(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  await markTripPaymentState({
    metadata: paymentIntent.metadata,
    stripePaymentIntentId: paymentIntent.id,
    nextStatus: 'FAILED'
  });
}

export async function markTripPaymentExpiredFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  await markTripPaymentState({
    metadata: session.metadata,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    nextStatus: 'EXPIRED'
  });
}
