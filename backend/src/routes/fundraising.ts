import Stripe from 'stripe';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { handleRouteError } from '../lib/route-error.js';
import { stripe } from '../lib/stripe.js';
import { logAudit } from '../lib/audit-log.js';
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
  donationOptionId: z.string().trim().min(1).max(80).optional(),
  donationOptionName: z.string().trim().min(1).max(140).optional(),
  donationLevelId: z.string().trim().min(1).max(80).optional(),
  donationLevelTitle: z.string().trim().min(1).max(140).optional(),
  donationLevelAmountLabel: z.string().trim().min(1).max(80).optional()
});

const adminDonationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
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
        const metadata: Record<string, string> = {
          source: 'fundraising_donation',
          amountCents: String(amountCents),
          donorName,
          donorEmail,
          donorRecognitionPreference
        };

        if (parsed.data.donationOptionId) metadata.donationOptionId = parsed.data.donationOptionId;
        if (parsed.data.donationOptionName) metadata.donationOptionName = parsed.data.donationOptionName;
        if (parsed.data.donationLevelId) metadata.donationLevelId = parsed.data.donationLevelId;
        if (parsed.data.donationLevelTitle) metadata.donationLevelTitle = parsed.data.donationLevelTitle;
        if (parsed.data.donationLevelAmountLabel) metadata.donationLevelAmountLabel = parsed.data.donationLevelAmountLabel;

        const donorDescriptor = donorRecognitionPreference === 'anonymous' ? 'Anonymous Donor' : donorName;
        const donationDescriptor = parsed.data.donationOptionName
          ? `${parsed.data.donationOptionName}: ${donorDescriptor}`
          : donorDescriptor;
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
        .filter((intent) => intent.metadata?.source === 'fundraising_donation')
        .slice(0, requestedLimit);

      const reconciledIntents = await Promise.all(
        donationIntents.map(async (intent) => {
          if (intent.status !== 'succeeded' || intent.metadata?.thankYouEmailSent === 'true') {
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
          donationOptionName: intent.metadata?.donationOptionName || null,
          donationLevelTitle: intent.metadata?.donationLevelTitle || null,
          donationLevelAmountLabel: intent.metadata?.donationLevelAmountLabel || null,
          receiptEmail: intent.receipt_email || null,
          createdAt: new Date(intent.created * 1000).toISOString(),
          thankYouEmailSent: intent.metadata?.thankYouEmailSent === 'true'
        }));

      const succeeded = donations.filter((donation) => donation.status === 'succeeded');
      const grossSucceededCents = succeeded.reduce((sum, donation) => sum + donation.amountCents, 0);

      return reply.send({
        donations,
        summary: {
          count: donations.length,
          succeededCount: succeeded.length,
          grossSucceededCents
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
