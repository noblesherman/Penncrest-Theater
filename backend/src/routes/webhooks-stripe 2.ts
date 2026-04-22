/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/webhooks-stripe 2.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: This filename looks like a duplicate snapshot (`... 2.*`), so confirm which twin is truly wired before touching logic.
*/

import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { releaseHoldByToken } from '../services/hold-service.js';
import { finalizeCheckoutSession, finalizePaymentIntent } from '../services/stripe-checkout-finalization.js';
import { releasePendingStudentCreditForOrder } from '../services/student-ticket-credit-service.js';
import { syncRefundFromCharge } from '../services/order-refund-service.js';

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
            const result = await finalizePaymentIntent(event.data.object as Stripe.PaymentIntent);
            if (result.outcome === 'finalization_failed') {
              app.log.error(
                {
                  stripePaymentIntentId: (event.data.object as Stripe.PaymentIntent).id,
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
            const holdToken = paymentIntent.metadata?.holdToken;

            if (orderId) {
              await prisma.order.updateMany({
                where: { id: orderId, status: 'PENDING' },
                data: { status: 'CANCELED' }
              });
              await releasePendingStudentCreditForOrder(orderId);
            }

            if (holdToken) {
              await releaseHoldByToken(holdToken);
            }
            break;
          }
          case 'checkout.session.expired': {
            const session = event.data.object as Stripe.Checkout.Session;
            const orderId = session.metadata?.orderId;
            const holdToken = session.metadata?.holdToken;

            if (orderId) {
              await prisma.order.updateMany({
                where: { id: orderId, status: 'PENDING' },
                data: { status: 'CANCELED' }
              });
              await releasePendingStudentCreditForOrder(orderId);
            }

            if (holdToken) {
              await releaseHoldByToken(holdToken);
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

        reply.send({ received: true });
      } catch (err) {
        handleRouteError(reply, err, 'Stripe webhook handling failed');
      }
    }
  );
};
