import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { checkoutRequestSchema } from '../validation.js';
import { HttpError } from '../errors.js';
import { computeSeatPrice } from './pricing.js';
import { stripe } from '../server.js';
import Stripe from 'stripe';
import crypto from 'crypto';

export const checkoutController = {
  createCheckoutSession: async (req: Request, res: Response) => {
    const performanceId = req.params.id;
    const parse = checkoutRequestSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
    const { seatIds, tierId, clientSessionToken, buyerEmail, buyerName, promoCode } = parse.data;

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: performanceId },
        include: {
          tiers: true,
          priceRules: true,
          show: { select: { title: true } }
        }
      });
      if (!performance) throw new HttpError(404, 'Performance not found');

      // Validate hold exists and matches
      const hold = await prisma.hold.findFirst({
        where: { performanceId, clientToken: clientSessionToken, status: 'ACTIVE' },
        include: { holdSeats: true }
      });
      if (!hold) throw new HttpError(400, 'Hold expired');
      const heldSeatIds = hold.holdSeats.map((s) => s.seatId);
      const requestedSet = new Set(seatIds);
      if (heldSeatIds.length !== seatIds.length || !heldSeatIds.every((id) => requestedSet.has(id))) {
        throw new HttpError(400, 'Held seats mismatch');
      }

      const tier = performance.tiers.find((t) => t.id === tierId && t.active);
      if (!tier) throw new HttpError(400, 'Tier invalid');

      const seats = await prisma.seat.findMany({ where: { id: { in: seatIds } } });
      if (seats.length !== seatIds.length) throw new HttpError(400, 'Seats not found');

      // Pricing
      let subtotal = 0;
      const priceRules = performance.priceRules;
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

      for (const seat of seats) {
        const priceCents = computeSeatPrice({ tier, seat, priceRules });
        subtotal += priceCents;
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${performance.show.title} - ${seat.seatLabel}`
            },
            unit_amount: priceCents
          },
          quantity: 1
        });
      }

      // TODO: fees and promo codes application
      const feeCents = 0;
      const totalCents = subtotal + feeCents;

      const orderKey = crypto.randomUUID();

      // Persist pending order
      const order = await prisma.order.create({
        data: {
          performanceId,
          buyerEmail,
          buyerName,
          status: 'PENDING',
          subtotalCents: subtotal,
          feeCents,
          totalCents,
          stripeSessionId: null,
          stripePaymentIntentId: null
        }
      });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: buyerEmail,
        line_items: lineItems,
        success_url: `${process.env.APP_URL}/confirmation?orderId=${order.id}`,
        cancel_url: `${process.env.APP_URL}/shows/${performance.showId}`,
        metadata: {
          performanceId,
          holdId: hold.id,
          seatIds: JSON.stringify(seatIds),
          clientSessionToken,
          orderKey,
          orderId: order.id,
          tierId
        }
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { stripeSessionId: session.id }
      });

      res.json({ url: session.url });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      res.status(status).json({ error: err.message || 'Checkout failed' });
    }
  }
};
