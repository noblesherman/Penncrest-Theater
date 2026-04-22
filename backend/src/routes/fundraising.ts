import Stripe from 'stripe';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { handleRouteError } from '../lib/route-error.js';
import { stripe } from '../lib/stripe.js';
import { logAudit } from '../lib/audit-log.js';
import { HttpError } from '../lib/http-error.js';
import { reconcileDonationThankYouEmail } from '../services/donation-thank-you-service.js';
import { releasePendingStudentCreditForOrderTx } from '../services/student-ticket-credit-service.js';

const DONATION_CATALOG_SCOPE = 'fundraising';
const DONATION_CATALOG_SLUG = 'donation-options';

const donationLevelCatalogSchema = z.object({
  id: z.string().trim().min(1).max(80),
  amountLabel: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(140),
  detail: z.string().trim().min(1).max(500),
  suggestedAmountCents: z.coerce.number().int().min(100).max(250000)
});

const donationOptionCatalogSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(140),
  description: z.string().trim().max(320).default(''),
  levels: z.array(donationLevelCatalogSchema).min(1).max(24)
});

const donationCatalogSchema = z.object({
  options: z.array(donationOptionCatalogSchema).min(1).max(12)
});

const defaultFundraisingDonationOptions: z.infer<typeof donationCatalogSchema>['options'] = [
  {
    id: 'regular-donation',
    name: 'Regular Donation',
    description: 'Support costumes, sets, rehearsal materials, and production needs across the full season.',
    levels: [
      {
        id: 'regular-spotlight-supporter',
        amountLabel: '$25',
        title: 'Spotlight Supporter',
        detail: 'Supports scripts, rehearsal essentials, and student project supplies.',
        suggestedAmountCents: 2500
      },
      {
        id: 'regular-stage-builder',
        amountLabel: '$100',
        title: 'Stage Builder',
        detail: 'Helps cover set construction materials, paint, and prop hardware.',
        suggestedAmountCents: 10000
      },
      {
        id: 'regular-season-champion',
        amountLabel: '$250+',
        title: 'Season Champion',
        detail: 'Funds costumes, microphones, and production support for major shows.',
        suggestedAmountCents: 25000
      }
    ]
  },
  {
    id: 'scholarship-donation',
    name: 'Scholarship Donation',
    description: 'Fund student participation scholarships so every performer can join regardless of financial barriers.',
    levels: [
      {
        id: 'scholarship-script-starter',
        amountLabel: '$50',
        title: 'Script Starter',
        detail: 'Offsets script, workbook, and rehearsal supply costs for one student.',
        suggestedAmountCents: 5000
      },
      {
        id: 'scholarship-ensemble-boost',
        amountLabel: '$150',
        title: 'Ensemble Boost',
        detail: 'Helps cover costume pieces and production fees for participating students.',
        suggestedAmountCents: 15000
      },
      {
        id: 'scholarship-full-spotlight',
        amountLabel: '$500+',
        title: 'Full Spotlight',
        detail: 'Provides major scholarship support for student theater participation during the season.',
        suggestedAmountCents: 50000
      }
    ]
  },
  {
    id: 'sponsorship-donation',
    name: 'Sponsorship Donation',
    description: 'Contribute at sponsor-level support with recognition and outreach benefits for your organization.',
    levels: [
      {
        id: 'sponsor-balcony',
        amountLabel: '$50 - $249',
        title: 'Balcony',
        detail: 'Quarter-page ad in our programs for all four productions next school year, plus listing on the sponsor page.',
        suggestedAmountCents: 5000
      },
      {
        id: 'sponsor-mezzanine',
        amountLabel: '$250 - $499',
        title: 'Mezzanine',
        detail: 'Everything in Balcony, plus tax-deductible donation documentation and a half-page program ad.',
        suggestedAmountCents: 25000
      },
      {
        id: 'sponsor-orchestra',
        amountLabel: '$500 - $999',
        title: 'Orchestra',
        detail: 'Everything in Mezzanine, plus listing on donor posters displayed during performances and a full-page program ad.',
        suggestedAmountCents: 50000
      },
      {
        id: 'sponsor-center-stage',
        amountLabel: '$1,000+',
        title: 'Center Stage',
        detail: 'Everything in Orchestra, plus sponsor listing on all advertising and press releases.',
        suggestedAmountCents: 100000
      }
    ]
  }
];

const donationIntentSchema = z.object({
  amountCents: z.coerce.number().int().min(100).max(100000),
  donorName: z.string().trim().min(1).max(120),
  donorEmail: z.string().trim().email().max(320),
  donorRecognitionPreference: z.enum(['known', 'anonymous']).optional(),
  donationOptionId: z.string().trim().min(1).max(80),
  donationOptionName: z.string().trim().min(1).max(140).optional(),
  donationLevelId: z.string().trim().min(1).max(80).optional(),
  donationLevelTitle: z.string().trim().min(1).max(140).optional(),
  donationLevelAmountLabel: z.string().trim().min(1).max(80).optional()
});

const adminDonationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const adminDonationDetailParamsSchema = z.object({
  paymentIntentId: z.string().trim().min(1).max(255)
});

const adminFundraisingAttendeesParamsSchema = z.object({
  performanceId: z.string().trim().min(1)
});

const adminFundraisingDeleteOrdersParamsSchema = z.object({
  performanceId: z.string().trim().min(1)
});

function isMissingContentPageTableError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

function isoFromUnix(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function isDeletedStripeCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer): customer is Stripe.DeletedCustomer {
  return 'deleted' in customer && customer.deleted === true;
}

type StripeActivityEntry = {
  key: string;
  label: string;
  status: 'success' | 'warning' | 'info';
  occurredAt: string;
};

function buildStripeActivity(params: {
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  refunds: Stripe.Refund[];
}): StripeActivityEntry[] {
  const entries: StripeActivityEntry[] = [];

  const paymentCreatedAt = isoFromUnix(params.paymentIntent.created);
  if (paymentCreatedAt) {
    entries.push({
      key: `pi-created:${params.paymentIntent.id}`,
      label: 'Payment started',
      status: 'info',
      occurredAt: paymentCreatedAt
    });
  }

  if (params.paymentIntent.status === 'succeeded') {
    const succeededAt =
      isoFromUnix(params.charge?.created ?? null) ||
      isoFromUnix(params.paymentIntent.created);
    if (succeededAt) {
      entries.push({
        key: `pi-succeeded:${params.paymentIntent.id}`,
        label: 'Payment succeeded',
        status: 'success',
        occurredAt: succeededAt
      });
    }
  }

  if (params.paymentIntent.status === 'requires_payment_method' || params.paymentIntent.status === 'canceled') {
    const blockedAt =
      isoFromUnix(params.paymentIntent.canceled_at) ||
      isoFromUnix(params.paymentIntent.created);
    if (blockedAt) {
      entries.push({
        key: `pi-blocked:${params.paymentIntent.id}`,
        label: params.paymentIntent.status === 'canceled' ? 'Payment canceled' : 'Payment needs attention',
        status: 'warning',
        occurredAt: blockedAt
      });
    }
  }

  if (params.charge) {
    const chargeCreatedAt = isoFromUnix(params.charge.created);
    if (chargeCreatedAt) {
      entries.push({
        key: `charge:${params.charge.id}`,
        label:
          params.charge.status === 'succeeded'
            ? 'Charge captured'
            : params.charge.status === 'failed'
              ? 'Charge failed'
              : `Charge ${params.charge.status}`,
        status: params.charge.status === 'succeeded' ? 'success' : params.charge.status === 'failed' ? 'warning' : 'info',
        occurredAt: chargeCreatedAt
      });
    }
  }

  params.refunds.forEach((refund) => {
    const occurredAt = isoFromUnix(refund.created);
    if (!occurredAt) return;

    entries.push({
      key: `refund:${refund.id}`,
      label: `Refund ${refund.status}`,
      status: refund.status === 'succeeded' ? 'success' : refund.status === 'failed' ? 'warning' : 'info',
      occurredAt
    });
  });

  return entries
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 12);
}

async function loadDonationCatalogStore(): Promise<{
  options: z.infer<typeof donationOptionCatalogSchema>[];
  isCustomized: boolean;
  updatedAt: string | null;
}> {
  const row = await prisma.contentPage.findUnique({
    where: {
      scope_slug: {
        scope: DONATION_CATALOG_SCOPE,
        slug: DONATION_CATALOG_SLUG
      }
    }
  });

  if (!row) {
    return {
      options: defaultFundraisingDonationOptions,
      isCustomized: false,
      updatedAt: null
    };
  }

  const parsed = donationCatalogSchema.safeParse(row.content);
  if (!parsed.success) {
    return {
      options: defaultFundraisingDonationOptions,
      isCustomized: false,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  return {
    options: parsed.data.options,
    isCustomized: true,
    updatedAt: row.updatedAt.toISOString()
  };
}

async function saveDonationCatalogStore(
  options: z.infer<typeof donationOptionCatalogSchema>[],
  adminId?: string | null
) {
  return prisma.contentPage.upsert({
    where: {
      scope_slug: {
        scope: DONATION_CATALOG_SCOPE,
        slug: DONATION_CATALOG_SLUG
      }
    },
    update: {
      title: 'Fundraising Donation Options',
      content: { options } as unknown as Prisma.InputJsonValue,
      updatedByAdminId: adminId ?? null
    },
    create: {
      scope: DONATION_CATALOG_SCOPE,
      slug: DONATION_CATALOG_SLUG,
      title: 'Fundraising Donation Options',
      content: { options } as unknown as Prisma.InputJsonValue,
      updatedByAdminId: adminId ?? null
    }
  });
}

type DonationSelectionMetadata = {
  donationOptionId: string;
  donationOptionName: string;
  donationLevelId: string;
  donationLevelTitle: string;
  donationLevelAmountLabel: string;
  donationSelectionType: 'level' | 'custom';
  donationBucketKey: string;
  donationBucketLabel: string;
};

function resolveDonationSelectionMetadata(params: {
  options: z.infer<typeof donationOptionCatalogSchema>[];
  donationOptionId: string;
  donationLevelId?: string;
}): DonationSelectionMetadata {
  const option = params.options.find((row) => row.id === params.donationOptionId);
  if (!option) {
    throw new HttpError(400, 'Selected donation path is no longer available. Refresh and choose again.');
  }

  if (!params.donationLevelId) {
    const donationLevelId = 'custom';
    const donationLevelTitle = 'Custom Amount';
    const donationLevelAmountLabel = 'Custom';
    return {
      donationOptionId: option.id,
      donationOptionName: option.name,
      donationLevelId,
      donationLevelTitle,
      donationLevelAmountLabel,
      donationSelectionType: 'custom',
      donationBucketKey: `${option.id}:${donationLevelId}`,
      donationBucketLabel: `${option.name} - ${donationLevelTitle}`
    };
  }

  const level = option.levels.find((row) => row.id === params.donationLevelId);
  if (!level) {
    throw new HttpError(400, 'Selected donation level is no longer available for this donation path.');
  }

  return {
    donationOptionId: option.id,
    donationOptionName: option.name,
    donationLevelId: level.id,
    donationLevelTitle: level.title,
    donationLevelAmountLabel: level.amountLabel,
    donationSelectionType: 'level',
    donationBucketKey: `${option.id}:${level.id}`,
    donationBucketLabel: `${option.name} - ${level.title}`
  };
}

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
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/fundraising/donation-options', async (_request, reply) => {
    try {
      const payload = await loadDonationCatalogStore();
      reply.send({ options: payload.options });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send({ options: defaultFundraisingDonationOptions });
        return;
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch donation options');
    }
  });

  app.get('/api/admin/fundraising/donation-options', { preHandler: app.authenticateAdmin }, async (_request, reply) => {
    try {
      const payload = await loadDonationCatalogStore();
      reply.send(payload);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send({
          options: defaultFundraisingDonationOptions,
          isCustomized: false,
          updatedAt: null
        });
        return;
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch donation option admin data');
    }
  });

  app.put('/api/admin/fundraising/donation-options', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = donationCatalogSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const saved = await saveDonationCatalogStore(parsed.data.options, request.adminUser?.id ?? null);
      const levelCount = parsed.data.options.reduce((sum, option) => sum + option.levels.length, 0);

      await logAudit({
        actor: request.user?.username || request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'FUNDRAISING_DONATION_OPTIONS_UPDATED',
        entityType: 'ContentPage',
        entityId: saved.id,
        metadata: {
          optionCount: parsed.data.options.length,
          levelCount
        }
      });

      return reply.send({
        options: parsed.data.options,
        isCustomized: true,
        updatedAt: saved.updatedAt.toISOString()
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply
          .status(503)
          .send({ error: 'Donation option storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to save donation options');
    }
  });

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
        const donorName = parsed.data.donorName.trim();
        const donorEmail = parsed.data.donorEmail.trim().toLowerCase();
        const donorRecognitionPreference = parsed.data.donorRecognitionPreference || 'known';
        const catalogStore = await loadDonationCatalogStore();
        const selection = resolveDonationSelectionMetadata({
          options: catalogStore.options,
          donationOptionId: parsed.data.donationOptionId,
          donationLevelId: parsed.data.donationLevelId
        });

        const metadata: Record<string, string> = {
          source: 'fundraising_donation',
          amountCents: String(amountCents),
          donorName,
          donorEmail,
          donorRecognitionPreference,
          donationOptionId: selection.donationOptionId,
          donationOptionName: selection.donationOptionName,
          donationLevelId: selection.donationLevelId,
          donationLevelTitle: selection.donationLevelTitle,
          donationLevelAmountLabel: selection.donationLevelAmountLabel,
          donationSelectionType: selection.donationSelectionType,
          donationBucketKey: selection.donationBucketKey,
          donationBucketLabel: selection.donationBucketLabel
        };

        const donorDescriptor = donorRecognitionPreference === 'anonymous' ? 'Anonymous Donor' : donorName;
        const donationDescriptor = `${selection.donationBucketLabel}: ${donorDescriptor}`;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
          receipt_email: donorEmail,
          description: `Penncrest Theater donation (${donationDescriptor})`,
          metadata
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

        handleRouteError(reply, err, 'We hit a small backstage snag while trying to create donation payment intent');
      }
    }
  );

  app.get('/api/admin/fundraising/donations', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = adminDonationListQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const requestedLimit = parsed.data.limit;
      const intents = await stripe.paymentIntents.list({ limit: 100 });
      const donationIntents = intents.data
        .filter((intent) => intent.metadata?.source === 'fundraising_donation' && intent.status === 'succeeded')
        .slice(0, requestedLimit);

      const reconciledIntents = await Promise.all(
        donationIntents.map(async (intent) => {
          if (intent.metadata?.thankYouEmailSent === 'true') {
            return intent;
          }

          const reconcileResult = await reconcileDonationThankYouEmail(intent);
          if (reconcileResult.outcome === 'missing_email') {
            app.log.warn(
              { stripePaymentIntentId: intent.id },
              'Donation reconciliation skipped because donor email is missing'
            );
          } else if (reconcileResult.outcome === 'failed') {
            app.log.error(
              {
                stripePaymentIntentId: intent.id,
                error: reconcileResult.errorMessage || 'Unknown donation thank-you failure'
              },
              'Donation thank-you reconciliation failed during admin listing'
            );
          }

          return reconcileResult.paymentIntent;
        })
      );

      const donations = reconciledIntents
        .map((intent) => ({
          paymentIntentId: intent.id,
          amountCents: intent.amount,
          currency: intent.currency || 'usd',
          status: intent.status,
          donorName: intent.metadata?.donorName || 'Supporter',
          donorEmail: intent.metadata?.donorEmail || intent.receipt_email || '',
          donorRecognitionPreference:
            intent.metadata?.donorRecognitionPreference === 'anonymous' ? 'anonymous' : 'known',
          donationOptionId: intent.metadata?.donationOptionId || null,
          donationOptionName: intent.metadata?.donationOptionName || null,
          donationLevelId: intent.metadata?.donationLevelId || null,
          donationLevelTitle: intent.metadata?.donationLevelTitle || null,
          donationLevelAmountLabel: intent.metadata?.donationLevelAmountLabel || null,
          donationSelectionType: intent.metadata?.donationSelectionType || null,
          donationBucketKey: intent.metadata?.donationBucketKey || null,
          donationBucketLabel: intent.metadata?.donationBucketLabel || null,
          receiptEmail: intent.receipt_email || null,
          createdAt: new Date(intent.created * 1000).toISOString(),
          thankYouEmailSent: intent.metadata?.thankYouEmailSent === 'true'
        }));

      const succeeded = donations.filter((donation) => donation.status === 'succeeded');
      const grossSucceededCents = succeeded.reduce((sum, donation) => sum + donation.amountCents, 0);
      const bucketTotalsMap = new Map<string, {
        bucketKey: string;
        bucketLabel: string;
        count: number;
        grossSucceededCents: number;
      }>();
      succeeded.forEach((donation) => {
        const fallbackBucketLabel = [donation.donationOptionName || 'Unassigned', donation.donationLevelTitle || 'Custom Amount'].join(' - ');
        const bucketLabel = donation.donationBucketLabel || fallbackBucketLabel;
        const bucketKey = donation.donationBucketKey || `${donation.donationOptionId || 'unknown'}:${donation.donationLevelId || 'custom'}`;
        const current = bucketTotalsMap.get(bucketKey) || {
          bucketKey,
          bucketLabel,
          count: 0,
          grossSucceededCents: 0
        };
        current.count += 1;
        current.grossSucceededCents += donation.amountCents;
        bucketTotalsMap.set(bucketKey, current);
      });
      const bucketTotals = Array.from(bucketTotalsMap.values()).sort(
        (a, b) => b.grossSucceededCents - a.grossSucceededCents || a.bucketLabel.localeCompare(b.bucketLabel)
      );

      return reply.send({
        donations,
        summary: {
          count: donations.length,
          succeededCount: succeeded.length,
          grossSucceededCents,
          bucketTotals
        }
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
        return reply.status(statusCode).send({ error: err.message || 'Payment provider error' });
      }

      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch donation admin data');
    }
  });

  app.get('/api/admin/fundraising/donations/:paymentIntentId', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = adminDonationDetailParamsSchema.safeParse(request.params || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      let paymentIntent: Stripe.PaymentIntent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId, {
        expand: ['latest_charge.balance_transaction', 'payment_method', 'customer']
      }) as Stripe.PaymentIntent;

      if (paymentIntent.metadata?.source !== 'fundraising_donation') {
        throw new HttpError(404, 'Donation not found');
      }

      if (paymentIntent.metadata?.thankYouEmailSent !== 'true') {
        const reconcileResult = await reconcileDonationThankYouEmail(paymentIntent);
        paymentIntent = reconcileResult.paymentIntent;
      }

      const charge =
        paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== 'string'
          ? paymentIntent.latest_charge
          : null;
      const balanceTransaction =
        charge?.balance_transaction && typeof charge.balance_transaction !== 'string'
          ? charge.balance_transaction
          : null;

      let paymentMethod =
        paymentIntent.payment_method && typeof paymentIntent.payment_method !== 'string'
          ? paymentIntent.payment_method
          : null;
      if (!paymentMethod && typeof paymentIntent.payment_method === 'string') {
        try {
          paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
        } catch (err) {
          if (err instanceof Stripe.errors.StripeError) {
            app.log.warn(
              { err, paymentMethodId: paymentIntent.payment_method, paymentIntentId: paymentIntent.id },
              'We hit a small backstage snag while trying to retrieve Stripe payment method'
            );
          } else {
            throw err;
          }
        }
      }

      const chargeCardDetails =
        charge?.payment_method_details?.type === 'card' ? charge.payment_method_details.card : null;
      const cardDetails = paymentMethod?.card ?? null;
      const cardChecks = cardDetails?.checks || chargeCardDetails?.checks || null;
      const cardWalletType = cardDetails?.wallet?.type || chargeCardDetails?.wallet?.type || null;

      const expandedCustomer =
        paymentIntent.customer && typeof paymentIntent.customer !== 'string'
          ? paymentIntent.customer
          : null;
      const customer =
        expandedCustomer && !isDeletedStripeCustomer(expandedCustomer)
          ? expandedCustomer
          : null;

      const refunds = [...(charge?.refunds?.data || [])].sort((a, b) => b.created - a.created);
      const billingAddress = charge?.billing_details?.address || paymentMethod?.billing_details?.address || null;
      const billingEmail =
        charge?.billing_details?.email ||
        paymentMethod?.billing_details?.email ||
        paymentIntent.receipt_email ||
        paymentIntent.metadata?.donorEmail ||
        null;
      const billingName = charge?.billing_details?.name || paymentMethod?.billing_details?.name || null;

      const activity = buildStripeActivity({ paymentIntent, charge, refunds });
      const dashboardBase = paymentIntent.livemode ? 'https://dashboard.stripe.com' : 'https://dashboard.stripe.com/test';

      return reply.send({
        available: true,
        dashboardUrl: `${dashboardBase}/payments/${paymentIntent.id}`,
        donation: {
          donorName: paymentIntent.metadata?.donorName || 'Supporter',
          donorEmail: paymentIntent.metadata?.donorEmail || paymentIntent.receipt_email || '',
          donorRecognitionPreference:
            paymentIntent.metadata?.donorRecognitionPreference === 'anonymous' ? 'anonymous' : 'known',
          donationOptionId: paymentIntent.metadata?.donationOptionId || null,
          donationOptionName: paymentIntent.metadata?.donationOptionName || null,
          donationLevelId: paymentIntent.metadata?.donationLevelId || null,
          donationLevelTitle: paymentIntent.metadata?.donationLevelTitle || null,
          donationLevelAmountLabel: paymentIntent.metadata?.donationLevelAmountLabel || null,
          donationSelectionType: paymentIntent.metadata?.donationSelectionType || null,
          donationBucketKey: paymentIntent.metadata?.donationBucketKey || null,
          donationBucketLabel: paymentIntent.metadata?.donationBucketLabel || null,
          receiptEmail: paymentIntent.receipt_email || null,
          thankYouEmailSent: paymentIntent.metadata?.thankYouEmailSent === 'true'
        },
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          amountReceived: paymentIntent.amount_received,
          currency: paymentIntent.currency,
          createdAt: isoFromUnix(paymentIntent.created),
          canceledAt: isoFromUnix(paymentIntent.canceled_at),
          cancellationReason: paymentIntent.cancellation_reason,
          description: paymentIntent.description,
          captureMethod: paymentIntent.capture_method,
          statementDescriptor: paymentIntent.statement_descriptor,
          statementDescriptorSuffix: paymentIntent.statement_descriptor_suffix,
          paymentMethodTypes: paymentIntent.payment_method_types,
          livemode: paymentIntent.livemode
        },
        paymentMethod: {
          id: paymentMethod?.id || (typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : null),
          type: paymentMethod?.type || charge?.payment_method_details?.type || null,
          brand: cardDetails?.brand || chargeCardDetails?.brand || null,
          displayBrand: cardDetails?.display_brand || null,
          funding: cardDetails?.funding || chargeCardDetails?.funding || null,
          last4: cardDetails?.last4 || chargeCardDetails?.last4 || null,
          fingerprint: cardDetails?.fingerprint || chargeCardDetails?.fingerprint || null,
          expMonth: cardDetails?.exp_month || chargeCardDetails?.exp_month || null,
          expYear: cardDetails?.exp_year || chargeCardDetails?.exp_year || null,
          issuer: cardDetails?.issuer || chargeCardDetails?.issuer || null,
          country: cardDetails?.country || chargeCardDetails?.country || null,
          network: chargeCardDetails?.network || cardDetails?.networks?.preferred || null,
          walletType: cardWalletType,
          checks: {
            cvcCheck: cardChecks?.cvc_check || null,
            addressLine1Check: cardChecks?.address_line1_check || null,
            addressPostalCodeCheck: cardChecks?.address_postal_code_check || null
          }
        },
        charge: charge
          ? {
              id: charge.id,
              status: charge.status,
              paid: charge.paid,
              captured: charge.captured,
              amount: charge.amount,
              amountCaptured: charge.amount_captured,
              amountRefunded: charge.amount_refunded,
              createdAt: isoFromUnix(charge.created),
              receiptEmail: charge.receipt_email,
              receiptUrl: charge.receipt_url,
              failureCode: charge.failure_code,
              failureMessage: charge.failure_message,
              statementDescriptor: charge.statement_descriptor,
              statementDescriptorSuffix: charge.statement_descriptor_suffix,
              outcome: charge.outcome
                ? {
                    riskLevel: charge.outcome.risk_level || null,
                    riskScore: charge.outcome.risk_score ?? null,
                    networkStatus: charge.outcome.network_status,
                    sellerMessage: charge.outcome.seller_message,
                    type: charge.outcome.type
                  }
                : null,
              billingDetails: {
                name: billingName,
                email: billingEmail,
                phone: charge.billing_details?.phone || paymentMethod?.billing_details?.phone || null,
                postalCode: billingAddress?.postal_code || null,
                country: billingAddress?.country || null
              }
            }
          : null,
        balance: balanceTransaction
          ? {
              id: balanceTransaction.id,
              amount: balanceTransaction.amount,
              fee: balanceTransaction.fee,
              net: balanceTransaction.net,
              type: balanceTransaction.type,
              reportingCategory: balanceTransaction.reporting_category,
              availableOn: isoFromUnix(balanceTransaction.available_on),
              exchangeRate: balanceTransaction.exchange_rate,
              feeDetails: balanceTransaction.fee_details.map((row) => ({
                amount: row.amount,
                currency: row.currency,
                description: row.description,
                type: row.type
              }))
            }
          : null,
        customer: {
          id: customer?.id || (typeof paymentIntent.customer === 'string' ? paymentIntent.customer : null),
          name: customer?.name || billingName,
          email: customer?.email || billingEmail,
          phone: customer?.phone || charge?.billing_details?.phone || paymentMethod?.billing_details?.phone || null,
          country: customer?.address?.country || billingAddress?.country || null
        },
        refunds: refunds.map((refund) => ({
          id: refund.id,
          status: refund.status,
          amount: refund.amount,
          reason: refund.reason,
          createdAt: isoFromUnix(refund.created)
        })),
        activity,
        metadata: paymentIntent.metadata
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const isMissing = err.code === 'resource_missing' || err.type === 'StripeInvalidRequestError';
        return reply.status(isMissing ? 404 : 502).send({ error: isMissing ? 'Donation not found' : (err.message || 'Stripe request failed') });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch donation details');
    }
  });

  app.get('/api/admin/fundraising/events/:performanceId/attendees', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = adminFundraisingAttendeesParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: parsedParams.data.performanceId },
        select: {
          id: true,
          isFundraiser: true,
          seatSelectionEnabled: true,
          title: true,
          show: { select: { title: true } }
        }
      });

      if (!performance) {
        return reply.status(404).send({ error: 'Fundraising event not found' });
      }

      if (!performance.isFundraiser) {
        return reply.status(400).send({ error: 'Selected performance is not a fundraising event' });
      }

      const orders = await prisma.order.findMany({
        where: {
          performanceId: parsedParams.data.performanceId,
          status: { not: 'CANCELED' }
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          accessToken: true,
          status: true,
          source: true,
          email: true,
          customerName: true,
          amountTotal: true,
          currency: true,
          createdAt: true,
          orderSeats: {
            orderBy: { createdAt: 'asc' },
            select: {
              seatId: true,
              attendeeName: true,
              ticketType: true,
              isComplimentary: true,
              price: true,
              seat: {
                select: {
                  sectionName: true,
                  row: true,
                  number: true
                }
              }
            }
          },
          tickets: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              seatId: true,
              publicId: true,
              checkedInAt: true,
              checkedInBy: true,
              checkInGate: true,
              admissionDecision: true,
              admissionReason: true
            }
          },
          registrationSubmission: {
            select: {
              id: true,
              submittedAt: true,
              responseJson: true,
              form: {
                select: {
                  id: true,
                  formName: true
                }
              },
              formVersion: {
                select: {
                  id: true,
                  versionNumber: true
                }
              }
            }
          }
        }
      });

      const rows = orders.map((order) => {
        const ticketBySeatId = new Map(
          order.tickets
            .filter((ticket) => Boolean(ticket.seatId))
            .map((ticket) => [ticket.seatId, ticket])
        );
        const gaTickets = order.tickets.filter((ticket) => !ticket.seatId);
        let gaTicketCursor = 0;

        return {
        id: order.id,
        accessToken: order.accessToken,
        status: order.status,
        source: order.source,
        email: order.email,
        customerName: order.customerName,
        amountTotal: order.amountTotal,
        currency: order.currency,
        createdAt: order.createdAt.toISOString(),
        orderSeats: order.orderSeats.map((seat, index) => {
          const matchedTicket =
            (seat.seatId ? ticketBySeatId.get(seat.seatId) : null) || gaTickets[gaTicketCursor++];

          return {
            seatId: seat.seatId,
            attendeeName: seat.attendeeName,
            ticketType: seat.ticketType,
            isComplimentary: seat.isComplimentary,
            price: seat.price,
            seatLabel: performance.seatSelectionEnabled
              ? seat.seat
                ? `${seat.seat.sectionName} · Row ${seat.seat.row} · Seat ${seat.seat.number}`
                : `Unassigned Seat ${index + 1}`
              : `General Admission Ticket ${index + 1}`,
            ticketId: matchedTicket?.id || null,
            ticketPublicId: matchedTicket?.publicId || null,
            checkedInAt: matchedTicket?.checkedInAt?.toISOString() || null,
            checkedInBy: matchedTicket?.checkedInBy || null,
            checkInGate: matchedTicket?.checkInGate || null,
            admissionDecision: matchedTicket?.admissionDecision || null,
            admissionReason: matchedTicket?.admissionReason || null
          };
        }),
        registrationSubmission: order.registrationSubmission
          ? {
              id: order.registrationSubmission.id,
              submittedAt: order.registrationSubmission.submittedAt.toISOString(),
              responseJson: order.registrationSubmission.responseJson,
              form: order.registrationSubmission.form,
              formVersion: order.registrationSubmission.formVersion
            }
          : null
      };
      });

      const ticketCount = rows.reduce((sum, row) => sum + row.orderSeats.length, 0);
      const responseCount = rows.filter((row) => Boolean(row.registrationSubmission)).length;

      return reply.send({
        performance: {
          id: performance.id,
          title: performance.title || performance.show.title,
          seatSelectionEnabled: performance.seatSelectionEnabled
        },
        summary: {
          orderCount: rows.length,
          ticketCount,
          responseCount
        },
        rows
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch fundraising attendee responses');
    }
  });

  app.delete(
    '/api/admin/fundraising/events/:performanceId/orders',
    { preHandler: app.requireAdminRole('ADMIN') },
    async (request, reply) => {
      const parsedParams = adminFundraisingDeleteOrdersParamsSchema.safeParse(request.params || {});
      if (!parsedParams.success) {
        return reply.status(400).send({ error: parsedParams.error.flatten() });
      }

      try {
        const performance = await prisma.performance.findUnique({
          where: { id: parsedParams.data.performanceId },
          select: {
            id: true,
            title: true,
            isFundraiser: true,
            show: { select: { title: true } }
          }
        });

        if (!performance) {
          return reply.status(404).send({ error: 'Fundraising event not found' });
        }

        if (!performance.isFundraiser) {
          return reply.status(400).send({ error: 'Selected performance is not a fundraising event' });
        }

        const result = await prisma.$transaction(async (tx) => {
          const [orderCount, ticketCount, orderSeatCount, responseCount] = await Promise.all([
            tx.order.count({ where: { performanceId: performance.id } }),
            tx.ticket.count({ where: { performanceId: performance.id } }),
            tx.orderSeat.count({ where: { order: { performanceId: performance.id } } }),
            tx.eventRegistrationSubmission.count({ where: { performanceId: performance.id } })
          ]);

          if (orderCount === 0) {
            return {
              performance,
              ordersDeleted: 0,
              ticketsDeleted: 0,
              orderSeatsDeleted: 0,
              submissionsDeleted: 0,
              seatsResetToAvailable: 0,
              pendingStudentCreditsReleased: 0
            };
          }

          const [orders, seatRows, tickets] = await Promise.all([
            tx.order.findMany({
              where: { performanceId: performance.id },
              select: {
                id: true
              }
            }),
            tx.orderSeat.findMany({
              where: {
                order: {
                  performanceId: performance.id
                },
                seatId: { not: null }
              },
              select: {
                seatId: true
              }
            }),
            tx.ticket.findMany({
              where: {
                performanceId: performance.id,
                seatId: { not: null }
              },
              select: {
                seatId: true
              }
            })
          ]);

          let pendingStudentCreditsReleased = 0;
          for (const order of orders) {
            pendingStudentCreditsReleased += await releasePendingStudentCreditForOrderTx(tx, order.id);
          }

          const seatIdsRaw = [
            ...seatRows.map((row) => row.seatId),
            ...tickets.map((row) => row.seatId)
          ];
          const seatIds = [...new Set(seatIdsRaw.filter((seatId): seatId is string => Boolean(seatId)))];
          let seatsResetToAvailable = 0;
          if (seatIds.length > 0) {
            const updatedSeats = await tx.seat.updateMany({
              where: {
                id: { in: seatIds },
                performanceId: performance.id,
                status: 'SOLD'
              },
              data: {
                status: 'AVAILABLE',
                holdSessionId: null
              }
            });
            seatsResetToAvailable = updatedSeats.count;
          }

          await tx.order.deleteMany({
            where: {
              performanceId: performance.id
            }
          });

          return {
            performance,
            ordersDeleted: orderCount,
            ticketsDeleted: ticketCount,
            orderSeatsDeleted: orderSeatCount,
            submissionsDeleted: responseCount,
            seatsResetToAvailable,
            pendingStudentCreditsReleased
          };
        });

        await logAudit({
          actor: adminActor(request),
          action: 'FUNDRAISER_EVENT_ORDERS_PURGED',
          entityType: 'Performance',
          entityId: result.performance.id,
          metadata: {
            performanceTitle: result.performance.title || result.performance.show.title,
            ordersDeleted: result.ordersDeleted,
            ticketsDeleted: result.ticketsDeleted,
            orderSeatsDeleted: result.orderSeatsDeleted,
            submissionsDeleted: result.submissionsDeleted,
            seatsResetToAvailable: result.seatsResetToAvailable,
            pendingStudentCreditsReleased: result.pendingStudentCreditsReleased
          }
        });

        return reply.send({
          success: true,
          performance: {
            id: result.performance.id,
            title: result.performance.title || result.performance.show.title
          },
          summary: {
            ordersDeleted: result.ordersDeleted,
            ticketsDeleted: result.ticketsDeleted,
            orderSeatsDeleted: result.orderSeatsDeleted,
            submissionsDeleted: result.submissionsDeleted,
            seatsResetToAvailable: result.seatsResetToAvailable,
            pendingStudentCreditsReleased: result.pendingStudentCreditsReleased
          }
        });
      } catch (err) {
        handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete fundraising event orders');
      }
    }
  );

  app.get('/api/fundraising/events', async (_request, reply) => {
    try {
      const now = new Date();
      const events = await prisma.performance.findMany({
        where: {
          isArchived: false,
          isFundraiser: true,
          isPublished: true,
          OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: now } }]
        },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          show: true,
          pricingTiers: true,
          orders: {
            select: {
              status: true,
              _count: {
                select: {
                  orderSeats: true
                }
              }
            }
          },
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
        const pricingValues = event.pricingTiers.map((tier) => tier.priceCents);
        const seatPrices = event.seats.map((seat) => seat.price);
        const minPrice = pricingValues.length > 0 ? Math.min(...pricingValues) : seatPrices.length > 0 ? Math.min(...seatPrices) : 0;
        const maxPrice = pricingValues.length > 0 ? Math.max(...pricingValues) : seatPrices.length > 0 ? Math.max(...seatPrices) : 0;
        const effectivelyAvailableCount = event.seats.filter((seat) => isSeatEffectivelyAvailable(seat)).length;

        let availableTickets = effectivelyAvailableCount;

        if (!event.seatSelectionEnabled) {
          // Legacy GA orders may leave SOLD seats behind without active order links after deletion/refund.
          const soldSeatCount = event.seats.filter((seat) => seat.status === 'SOLD').length;
          const activeMappedSeatCount = event.orders
            .filter((order) => order.status !== 'CANCELED' && order.status !== 'REFUNDED')
            .reduce((total, order) => total + order._count.orderSeats, 0);

          if (soldSeatCount > activeMappedSeatCount) {
            availableTickets = Math.min(
              event.seats.length,
              effectivelyAvailableCount + (soldSeatCount - activeMappedSeatCount)
            );
          }
        }

        return {
          id: event.id,
          title: event.title || event.show.title,
          description: event.show.description || '',
          posterUrl: event.show.posterUrl || '',
          startsAt: event.startsAt.toISOString(),
          onlineSalesStartsAt: event.onlineSalesStartsAt?.toISOString() || null,
          salesCutoffAt: event.salesCutoffAt?.toISOString() || null,
          salesOpen:
            (!event.onlineSalesStartsAt || event.onlineSalesStartsAt <= now) &&
            (event.salesCutoffAt || event.startsAt) > now,
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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch fundraising events');
    }
  });
};
