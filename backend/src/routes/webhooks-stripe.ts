import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { releaseHoldByToken } from '../services/hold-service.js';
import { finalizeCheckoutSession } from '../services/stripe-checkout-finalization.js';
import {
  releasePendingStudentCreditForOrder,
  restoreStudentCreditsForRefundTx
} from '../services/student-ticket-credit-service.js';

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
            if (typeof charge.payment_intent === 'string') {
              const orders = await prisma.order.findMany({
                where: { stripePaymentIntentId: charge.payment_intent },
                select: { id: true }
              });

              for (const order of orders) {
                await prisma.$transaction(async (tx) => {
                  await tx.order.updateMany({
                    where: { id: order.id },
                    data: { status: 'REFUNDED' }
                  });

                  await restoreStudentCreditsForRefundTx(tx, {
                    orderId: order.id,
                    restoredBy: 'stripe_webhook',
                    notes: 'Stripe charge.refunded webhook'
                  });
                });
              }
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
