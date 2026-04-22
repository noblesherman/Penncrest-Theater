/*
Handoff note for Mr. Smith:
- File: `apps/api/src/services/webhook-service.ts`
- What this is: Express service handler module (secondary API app).
- What it does: Contains request business logic used by route handlers.
- Connections: Invoked from routes and tied to Prisma/Stripe helpers.
- Main content type: Business logic with DB/payment side effects.
- Safe edits here: Comments and non-breaking readability improvements.
- Be careful with: Idempotency and write-order changes in checkout/payment flows.
- Useful context: If this app is still live anywhere, keep behavior changes tightly controlled.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../server.js';
import Stripe from 'stripe';
import crypto from 'crypto';
import { HttpError } from '../errors.js';
import { computeSeatPrice } from './pricing.js';

async function finalizeOrder(session: Stripe.Checkout.Session, tx = prisma) {
  if (!session.metadata) throw new HttpError(400, 'Missing metadata');
  const performanceId = session.metadata.performanceId as string;
  const holdId = session.metadata.holdId as string;
  const seatIds: string[] = JSON.parse(session.metadata.seatIds || '[]');
  const clientSessionToken = session.metadata.clientSessionToken as string;
  const orderId = session.metadata.orderId as string;

  // Idempotency: if order already paid return
  const existing = await tx.order.findUnique({ where: { stripeSessionId: session.id } });
  if (existing && existing.status === 'PAID') return existing;

  const hold = await tx.hold.findUnique({ where: { id: holdId }, include: { holdSeats: true } });
  if (!hold || hold.status !== 'ACTIVE') throw new HttpError(400, 'Hold not active');
  if (hold.clientToken !== clientSessionToken) throw new HttpError(400, 'Token mismatch');

  const heldSeatIds = new Set(hold.holdSeats.map((h) => h.seatId));
  if (seatIds.some((id) => !heldSeatIds.has(id))) throw new HttpError(400, 'Seat mismatch');

  const performanceSeatStates = await tx.performanceSeatState.findMany({ where: { holdId } });
  if (performanceSeatStates.length !== seatIds.length) throw new HttpError(400, 'Seat state mismatch');

  // Compute totals from DB to prevent tampering
  const seats = await tx.seat.findMany({ where: { id: { in: seatIds } } });
  const performance = await tx.performance.findUnique({
    where: { id: performanceId },
    include: { priceRules: true, tiers: true, show: { select: { title: true } } }
  });
  if (!performance) throw new HttpError(404, 'Performance missing');
  const tierId = session.metadata?.tierId as string;
  const tier = performance.tiers.find((t) => t.id === tierId);
  if (!tier) throw new HttpError(400, 'Tier missing');

  let subtotal = 0;
  for (const seat of seats) {
    subtotal += computeSeatPrice({ tier, seat, priceRules: performance.priceRules });
  }
  const feeCents = 0;
  const totalCents = subtotal + feeCents;

  const order = await tx.order.update({
    where: { id: orderId },
    data: {
      status: 'PAID',
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent as string,
      subtotalCents: subtotal,
      feeCents,
      totalCents
    }
  });

  const tickets = await Promise.all(
    seats.map((seat) =>
      tx.ticket.create({
        data: {
          orderId: order.id,
          performanceId,
          seatId: seat.id,
          tierName: tier.name,
          priceCents: tier.priceCents,
          qrSecret: crypto.randomBytes(16).toString('hex')
        }
      })
    )
  );

  await tx.performanceSeatState.updateMany({
    where: { holdId },
    data: { state: 'SOLD', orderId: order.id, holdId: null }
  });

  await tx.hold.update({ where: { id: holdId }, data: { status: 'CONVERTED' } });

  return { order, tickets };
}

async function releaseHold(holdId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.performanceSeatState.updateMany({ where: { holdId }, data: { state: 'AVAILABLE', holdId: null } });
    await tx.hold.update({ where: { id: holdId }, data: { status: 'RELEASED' } });
  });
}

export const webhookController = {
  handleWebhook: async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];
    let event: Stripe.Event;

    const buf = (req as any).rawBody || req.body;
    try {
      event = stripe.webhooks.constructEvent(buf, sig as string, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await prisma.$transaction(async (tx) => {
            await finalizeOrder(session, tx);
          });
          break;
        }
        case 'payment_intent.payment_failed': {
          const pi = event.data.object as Stripe.PaymentIntent;
          const holdId = pi.metadata?.holdId as string | undefined;
          if (holdId) await releaseHold(holdId);
          break;
        }
        case 'checkout.session.expired': {
          const session = event.data.object as Stripe.Checkout.Session;
          const holdId = session.metadata?.holdId as string | undefined;
          if (holdId) await releaseHold(holdId);
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (err: any) {
      console.error('Webhook error', err);
      res.status(500).json({ error: err.message });
    }
  }
};
