import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { handleRouteError } from '../lib/route-error.js';
import { expirePendingCheckoutAttempt } from '../services/checkout-attempt-service.js';
import { finalizeCheckoutSession, finalizePaymentIntent } from '../services/stripe-checkout-finalization.js';
import { syncRefundFromCharge } from '../services/order-refund-service.js';
import { reconcileDonationThankYouEmailByPaymentIntentId } from '../services/donation-thank-you-service.js';

const STRIPE_WEBHOOK_PROCESSING_STALE_MS = 5 * 60 * 1000;

type StripeWebhookEventClaimResult =
  | {
      action: 'process';
    }
  | {
      action: 'skip';
      reason: 'processed' | 'processing';
    };

type StripeWebhookLedgerRow = {
  status: 'PROCESSING' | 'PROCESSED' | 'FAILED';
  updatedAt: Date;
};

function toWebhookErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Stripe webhook processing failed';
}

async function claimStripeWebhookEvent(event: Stripe.Event): Promise<StripeWebhookEventClaimResult> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO "StripeWebhookEvent" (
      "id",
      "eventId",
      "eventType",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${event.id},
      ${event.id},
      ${event.type},
      CAST(${'PROCESSING'} AS "StripeWebhookEventStatus"),
      NOW(),
      NOW()
    )
    ON CONFLICT ("eventId") DO NOTHING
  `;

  if (inserted > 0) {
    return {
      action: 'process'
    };
  }

  const existingRows = await prisma.$queryRaw<StripeWebhookLedgerRow[]>`
    SELECT "status", "updatedAt"
    FROM "StripeWebhookEvent"
    WHERE "eventId" = ${event.id}
    LIMIT 1
  `;
  const existingEvent = existingRows[0];

  if (!existingEvent) {
    throw new Error(`Stripe webhook ledger row disappeared for event ${event.id}`);
  }

  if (existingEvent.status === 'PROCESSED') {
    return {
      action: 'skip',
      reason: 'processed'
    };
  }

  const isFreshProcessingAttempt =
    existingEvent.status === 'PROCESSING' &&
    Date.now() - existingEvent.updatedAt.getTime() < STRIPE_WEBHOOK_PROCESSING_STALE_MS;

  if (isFreshProcessingAttempt) {
    return {
      action: 'skip',
      reason: 'processing'
    };
  }

  const reclaimed = await prisma.$executeRaw`
    UPDATE "StripeWebhookEvent"
    SET
      "eventType" = ${event.type},
      "status" = CAST(${'PROCESSING'} AS "StripeWebhookEventStatus"),
      "processedAt" = NULL,
      "lastError" = NULL,
      "updatedAt" = NOW()
    WHERE
      "eventId" = ${event.id}
      AND "status" = CAST(${existingEvent.status} AS "StripeWebhookEventStatus")
      AND "updatedAt" = ${existingEvent.updatedAt}
  `;

  if (reclaimed === 0) {
    const latestRows = await prisma.$queryRaw<Array<Pick<StripeWebhookLedgerRow, 'status'>>>`
      SELECT "status"
      FROM "StripeWebhookEvent"
      WHERE "eventId" = ${event.id}
      LIMIT 1
    `;
    const latestEvent = latestRows[0];

    return {
      action: 'skip',
      reason: latestEvent?.status === 'PROCESSED' ? 'processed' : 'processing'
    };
  }

  return {
    action: 'process'
  };
}

async function markStripeWebhookEventProcessed(event: Stripe.Event): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "StripeWebhookEvent"
    SET
      "eventType" = ${event.type},
      "status" = CAST(${'PROCESSED'} AS "StripeWebhookEventStatus"),
      "processedAt" = NOW(),
      "lastError" = NULL,
      "updatedAt" = NOW()
    WHERE "eventId" = ${event.id}
  `;
}

async function markStripeWebhookEventFailed(event: Stripe.Event, err: unknown): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "StripeWebhookEvent"
    SET
      "eventType" = ${event.type},
      "status" = CAST(${'FAILED'} AS "StripeWebhookEventStatus"),
      "lastError" = ${toWebhookErrorMessage(err)},
      "updatedAt" = NOW()
    WHERE "eventId" = ${event.id}
  `;
}

async function processStripeWebhookEvent(app: FastifyInstance, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const result = await finalizeCheckoutSession(event.data.object as Stripe.Checkout.Session);
      if (result.outcome === 'finalization_failed') {
        app.log.error(
          {
            stripeSessionId: (event.data.object as Stripe.Checkout.Session).id,
            refundOutcome: result.refundOutcome || null
          },
          'Stripe checkout finalization failed and recovery was triggered'
        );
      }
      break;
    }
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const paymentSource = paymentIntent.metadata?.source;

      if (paymentSource === 'fundraising_donation') {
        const reconcileResult = await reconcileDonationThankYouEmailByPaymentIntentId(paymentIntent.id);

        if (reconcileResult.outcome === 'missing_email') {
          app.log.warn(
            { stripePaymentIntentId: paymentIntent.id },
            'Donation payment intent succeeded without donor email; thank-you email not sent'
          );
        }

        if (reconcileResult.outcome === 'failed') {
          throw new Error(
            `Donation thank-you reconciliation failed for ${paymentIntent.id}: ${
              reconcileResult.errorMessage || 'unknown error'
            }`
          );
        }

        break;
      }

      if (!paymentIntent.metadata?.orderId) {
        app.log.info(
          { stripePaymentIntentId: paymentIntent.id, source: paymentSource || null },
          'Ignoring payment_intent.succeeded without checkout order metadata'
        );
        break;
      }

      const result = await finalizePaymentIntent(paymentIntent);
      if (result.outcome === 'finalization_failed') {
        app.log.error(
          {
            stripePaymentIntentId: paymentIntent.id,
            refundOutcome: result.refundOutcome || null
          },
          'Stripe payment intent finalization failed and recovery was triggered'
        );
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = paymentIntent.metadata?.orderId;

      if (orderId) {
        await expirePendingCheckoutAttempt(orderId);
      }
      break;
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        await expirePendingCheckoutAttempt(orderId);
      }
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      await syncRefundFromCharge(charge);
      break;
    }
    default:
      break;
  }
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

        const claimResult = await claimStripeWebhookEvent(event);
        if (claimResult.action === 'skip') {
          app.log.info(
            {
              stripeEventId: event.id,
              stripeEventType: event.type,
              reason: claimResult.reason
            },
            'Skipping duplicate Stripe webhook event'
          );
          return reply.send({ received: true });
        }

        try {
          await processStripeWebhookEvent(app, event);
          await markStripeWebhookEventProcessed(event);
        } catch (err) {
          await markStripeWebhookEventFailed(event, err);
          throw err;
        }

        reply.send({ received: true });
      } catch (err) {
        handleRouteError(reply, err, 'Stripe webhook handling failed');
      }
    }
  );
};
