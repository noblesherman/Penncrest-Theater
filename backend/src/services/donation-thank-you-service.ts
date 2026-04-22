/*
Handoff note for Mr. Smith:
- File: `backend/src/services/donation-thank-you-service.ts`
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
import { sendDonationThankYouEmail } from '../lib/email.js';
import { stripe } from '../lib/stripe.js';

export type DonationThankYouReconciliationOutcome =
  | 'sent'
  | 'already_sent'
  | 'missing_email'
  | 'skipped_source'
  | 'skipped_status'
  | 'failed';

export type DonationThankYouReconciliationResult = {
  outcome: DonationThankYouReconciliationOutcome;
  paymentIntent: Stripe.PaymentIntent;
  errorMessage?: string;
};

const DONATION_SOURCE = 'fundraising_donation';

export async function reconcileDonationThankYouEmail(
  paymentIntent: Stripe.PaymentIntent
): Promise<DonationThankYouReconciliationResult> {
  if (paymentIntent.metadata?.source !== DONATION_SOURCE) {
    return { outcome: 'skipped_source', paymentIntent };
  }

  if (paymentIntent.status !== 'succeeded') {
    return { outcome: 'skipped_status', paymentIntent };
  }

  if (paymentIntent.metadata?.thankYouEmailSent === 'true') {
    return { outcome: 'already_sent', paymentIntent };
  }

  const donorEmail = (paymentIntent.metadata?.donorEmail || paymentIntent.receipt_email || '').trim().toLowerCase();
  if (!donorEmail) {
    return { outcome: 'missing_email', paymentIntent };
  }

  try {
    const donorName = (paymentIntent.metadata?.donorName || 'Supporter').trim();
    await sendDonationThankYouEmail({
      donorName,
      donorEmail,
      amountCents: paymentIntent.amount,
      currency: paymentIntent.currency || 'usd',
      paymentIntentId: paymentIntent.id
    });

    const updatedIntent = await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: {
        ...paymentIntent.metadata,
        thankYouEmailSent: 'true',
        thankYouEmailSentAt: new Date().toISOString()
      }
    });

    return { outcome: 'sent', paymentIntent: updatedIntent };
  } catch (err) {
    return {
      outcome: 'failed',
      paymentIntent,
      errorMessage: err instanceof Error ? err.message : 'Unknown donation thank-you failure'
    };
  }
}

export async function reconcileDonationThankYouEmailByPaymentIntentId(
  paymentIntentId: string
): Promise<DonationThankYouReconciliationResult> {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return reconcileDonationThankYouEmail(paymentIntent);
}
