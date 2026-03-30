import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { sendDonationThankYouEmail } from '../lib/email.js';
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
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            const paymentSource = paymentIntent.metadata?.source;

            if (paymentSource === 'fundraising_donation') {
              const refreshedIntent = await stripe.paymentIntents.retrieve(paymentIntent.id);
              const donorEmail = (refreshedIntent.metadata?.donorEmail || refreshedIntent.receipt_email || '').trim().toLowerCase();
              const donorName = (refreshedIntent.metadata?.donorName || 'Supporter').trim();
              const alreadySent = refreshedIntent.metadata?.thankYouEmailSent === 'true';

              if (!alreadySent && donorEmail) {
                await sendDonationThankYouEmail({
                  donorName,
                  donorEmail,
                  amountCents: refreshedIntent.amount,
                  currency: refreshedIntent.currency || 'usd',
                  paymentIntentId: refreshedIntent.id
                });

                await stripe.paymentIntents.update(refreshedIntent.id, {
                  metadata: {
                    ...refreshedIntent.metadata,
                    thankYouEmailSent: 'true',
                    thankYouEmailSentAt: new Date().toISOString()
                  }
                });
              }

              if (!donorEmail) {
                app.log.warn(
                  { stripePaymentIntentId: refreshedIntent.id },
                  'Donation payment intent succeeded without donor email; thank-you email not sent'
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
