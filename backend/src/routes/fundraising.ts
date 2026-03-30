import Stripe from 'stripe';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { handleRouteError } from '../lib/route-error.js';
import { stripe } from '../lib/stripe.js';

const donationIntentSchema = z.object({
  amountCents: z.coerce.number().int().min(100).max(100000)
});

function isSeatEffectivelyAvailable(seat: {
  status: string;
  holdSession?: {
    status: string;
    expiresAt: Date;
  } | null;
}): boolean {
  if (seat.status === 'AVAILABLE') {
    return true;
  }

  if (seat.status !== 'HELD') {
    return false;
  }

  return !seat.holdSession || seat.holdSession.status !== 'ACTIVE' || seat.holdSession.expiresAt < new Date();
}

export const fundraisingRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/fundraising/donations/intent',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const parsed = donationIntentSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const amountCents = parsed.data.amountCents;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
          description: 'Penncrest Theater donation',
          metadata: {
            source: 'fundraising_donation',
            amountCents: String(amountCents)
          }
        });

        if (!paymentIntent.client_secret) {
          return reply.status(500).send({ error: 'Stripe payment intent missing client secret' });
        }

        return reply.send({
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          publishableKey: env.STRIPE_PUBLISHABLE_KEY || undefined,
          amountCents,
          currency: 'usd'
        });
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError) {
          const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
          return reply.status(statusCode).send({ error: err.message || 'Payment provider error' });
        }

        handleRouteError(reply, err, 'Failed to create donation payment intent');
      }
    }
  );

  app.get('/api/fundraising/events', async (_request, reply) => {
    try {
      const events = await prisma.performance.findMany({
        where: {
          isArchived: false,
          isFundraiser: true
        },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          show: true,
          pricingTiers: true,
          seats: {
            select: {
              price: true,
              status: true,
              holdSession: {
                select: {
                  status: true,
                  expiresAt: true
                }
              }
            }
          }
        }
      });

      const payload = events.map((event) => {
        const now = new Date();
        const pricingValues = event.pricingTiers.map((tier) => tier.priceCents);
        const seatPrices = event.seats.map((seat) => seat.price);
        const minPrice = pricingValues.length > 0 ? Math.min(...pricingValues) : seatPrices.length > 0 ? Math.min(...seatPrices) : 0;
        const maxPrice = pricingValues.length > 0 ? Math.max(...pricingValues) : seatPrices.length > 0 ? Math.max(...seatPrices) : 0;
        const availableTickets = event.seats.filter((seat) => isSeatEffectivelyAvailable(seat)).length;

        return {
          id: event.id,
          title: event.title || event.show.title,
          description: event.show.description || '',
          posterUrl: event.show.posterUrl || '',
          startsAt: event.startsAt.toISOString(),
          salesCutoffAt: event.salesCutoffAt?.toISOString() || null,
          salesOpen: (event.salesCutoffAt || event.startsAt) > new Date(),
          venue: event.venue,
          notes: event.notes || '',
          seatSelectionEnabled: event.seatSelectionEnabled,
          minPrice,
          maxPrice,
          availableTickets
        };
      });

      reply.send(payload);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch fundraising events');
    }
  });
};
