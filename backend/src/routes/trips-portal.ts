import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../lib/env.js';
import { finalizeTripPaymentFromCheckoutSession, finalizeTripPaymentFromPaymentIntent } from '../services/trip-payment-finalization.js';

const claimStudentSchema = z.object({
  studentId: z.string().trim().min(1)
});

const startPaymentSessionSchema = z.object({
  enrollmentId: z.string().trim().min(1),
  amountCents: z.coerce.number().int().positive().max(500000)
});

function formatEnrollmentSummary(params: {
  enrollment: {
    id: string;
    targetAmountCents: number;
    dueAtOverride: Date | null;
    claimedAt: Date | null;
    trip: {
      id: string;
      title: string;
      slug: string;
      destination: string | null;
      startsAt: Date | null;
      dueAt: Date;
      allowPartialPayments: boolean;
      documents: Array<{
        id: string;
        title: string;
        fileUrl: string;
        mimeType: string;
        sizeBytes: number;
        sortOrder: number;
      }>;
    };
  };
  paidCents: number;
  now: Date;
}) {
  const dueAt = params.enrollment.dueAtOverride || params.enrollment.trip.dueAt;
  const targetAmountCents = params.enrollment.targetAmountCents;
  const paidAmountCents = Math.max(0, params.paidCents);
  const remainingAmountCents = Math.max(0, targetAmountCents - paidAmountCents);
  const isOverdue = remainingAmountCents > 0 && dueAt < params.now;

  return {
    enrollmentId: params.enrollment.id,
    targetAmountCents,
    paidAmountCents,
    remainingAmountCents,
    dueAt,
    dueAtOverridden: Boolean(params.enrollment.dueAtOverride),
    isOverdue,
    canPay: !isOverdue && remainingAmountCents > 0,
    allowPartialPayments: params.enrollment.trip.allowPartialPayments,
    claimedAt: params.enrollment.claimedAt,
    trip: {
      id: params.enrollment.trip.id,
      title: params.enrollment.trip.title,
      slug: params.enrollment.trip.slug,
      destination: params.enrollment.trip.destination,
      startsAt: params.enrollment.trip.startsAt,
      dueAt: params.enrollment.trip.dueAt,
      documents: params.enrollment.trip.documents
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((doc) => ({
          id: doc.id,
          title: doc.title,
          fileUrl: doc.fileUrl,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes
        }))
    }
  };
}

async function ensureStripeCustomerForTripAccount(account: {
  id: string;
  email: string;
  name: string | null;
  studentId: string | null;
  stripeCustomerId: string | null;
}) {
  if (account.stripeCustomerId) {
    return account.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: account.email,
    name: account.name || undefined,
    metadata: {
      source: 'trip_payment',
      accountId: account.id,
      studentId: account.studentId || ''
    }
  });

  await prisma.tripAccount.update({
    where: { id: account.id },
    data: {
      stripeCustomerId: customer.id
    }
  });

  return customer.id;
}

export const tripPortalRoutes: FastifyPluginAsync = async (app) => {
  const reconcilePendingTripPayment = async (payment: {
    id: string;
    status: string;
    stripeCheckoutSessionId: string | null;
    stripePaymentIntentId: string | null;
  }) => {
    if (payment.status !== 'PENDING') return;

    if (payment.stripeCheckoutSessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(payment.stripeCheckoutSessionId);
        if (session.status === 'complete' && session.payment_status === 'paid') {
          await finalizeTripPaymentFromCheckoutSession(session as Stripe.Checkout.Session);
          return;
        }
      } catch (err) {
        app.log.warn(err, `Trip payment reconciliation failed for stripe session ${payment.stripeCheckoutSessionId}`);
      }
    }

    if (!payment.stripePaymentIntentId) {
      return;
    }

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
      if (paymentIntent.status === 'succeeded') {
        await finalizeTripPaymentFromPaymentIntent(paymentIntent as Stripe.PaymentIntent);
      }
    } catch (err) {
      app.log.warn(err, `Trip payment reconciliation failed for stripe payment intent ${payment.stripePaymentIntentId}`);
    }
  };

  const reconcilePendingTripPaymentsForAccount = async (accountId: string) => {
    const pendingPayments = await prisma.tripPayment.findMany({
      where: {
        accountId,
        status: 'PENDING',
        OR: [{ stripeCheckoutSessionId: { not: null } }, { stripePaymentIntentId: { not: null } }]
      },
      select: {
        id: true,
        status: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 25
    });

    if (pendingPayments.length === 0) {
      return;
    }

    await Promise.allSettled(pendingPayments.map((payment) => reconcilePendingTripPayment(payment)));
  };

  app.get('/api/trips/portal/claim-options', { preHandler: app.authenticateTripAccount }, async (request, reply) => {
    try {
      const account = await prisma.tripAccount.findUnique({
        where: { id: request.tripAccount!.id },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              grade: true,
              isActive: true
            }
          }
        }
      });

      if (!account || !account.isActive) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (account.studentId) {
        return reply.send({
          account: {
            id: account.id,
            email: account.email,
            name: account.name,
            studentId: account.studentId,
            hasClaimedStudent: true
          },
          claimedStudent: account.student,
          claimableStudents: []
        });
      }

      const enrollments = await prisma.tripEnrollment.findMany({
        where: {
          claimedByAccountId: null,
          student: {
            isActive: true
          },
          trip: {
            isPublished: true,
            isArchived: false
          }
        },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              grade: true
            }
          },
          trip: {
            select: {
              id: true,
              title: true,
              dueAt: true
            }
          }
        },
        orderBy: [{ student: { name: 'asc' } }, { trip: { dueAt: 'asc' } }]
      });

      const grouped = new Map<
        string,
        {
          id: string;
          name: string;
          grade: string | null;
          trips: Array<{ id: string; title: string; dueAt: Date }>;
        }
      >();

      for (const enrollment of enrollments) {
        const current = grouped.get(enrollment.studentId) || {
          id: enrollment.student.id,
          name: enrollment.student.name,
          grade: enrollment.student.grade,
          trips: []
        };

        current.trips.push({
          id: enrollment.trip.id,
          title: enrollment.trip.title,
          dueAt: enrollment.trip.dueAt
        });

        grouped.set(enrollment.studentId, current);
      }

      reply.send({
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          studentId: null,
          hasClaimedStudent: false
        },
        claimedStudent: null,
        claimableStudents: [...grouped.values()]
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load claim options');
    }
  });

  app.post('/api/trips/portal/claim', { preHandler: app.authenticateTripAccount }, async (request, reply) => {
    const parsed = claimStudentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const account = await prisma.tripAccount.findUnique({
        where: { id: request.tripAccount!.id },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          studentId: true
        }
      });

      if (!account || !account.isActive) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (account.studentId && account.studentId !== parsed.data.studentId) {
        return reply.status(409).send({ error: 'Account already claimed a student' });
      }

      if (account.studentId === parsed.data.studentId) {
        const existingStudent = await prisma.tripStudent.findUnique({
          where: { id: account.studentId },
          select: { id: true, name: true, grade: true }
        });
        return reply.send({
          claimed: true,
          student: existingStudent
        });
      }

      const now = new Date();

      await prisma.$transaction(async (tx) => {
        const claimableEnrollment = await tx.tripEnrollment.findFirst({
          where: {
            studentId: parsed.data.studentId,
            claimedByAccountId: null,
            trip: {
              isPublished: true,
              isArchived: false
            }
          },
          select: {
            id: true
          }
        });

        if (!claimableEnrollment) {
          throw new HttpError(409, 'Student is already claimed');
        }

        const updated = await tx.tripAccount.updateMany({
          where: {
            id: account.id,
            studentId: null
          },
          data: {
            studentId: parsed.data.studentId
          }
        });

        if (updated.count === 0) {
          throw new HttpError(409, 'Account already claimed a student');
        }

        await tx.tripEnrollment.updateMany({
          where: {
            studentId: parsed.data.studentId,
            claimedByAccountId: null
          },
          data: {
            claimedByAccountId: account.id,
            claimedAt: now
          }
        });
      });

      const student = await prisma.tripStudent.findUnique({
        where: { id: parsed.data.studentId },
        select: {
          id: true,
          name: true,
          grade: true,
          isActive: true
        }
      });

      reply.send({
        claimed: true,
        student
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Student is already claimed' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to claim student');
    }
  });

  app.get('/api/trips/portal/dashboard', { preHandler: app.authenticateTripAccount }, async (request, reply) => {
    try {
      const account = await prisma.tripAccount.findUnique({
        where: { id: request.tripAccount!.id },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              grade: true,
              isActive: true
            }
          }
        }
      });

      if (!account || !account.isActive) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (!account.studentId) {
        return reply.status(409).send({ error: 'Student claim required' });
      }

      await reconcilePendingTripPaymentsForAccount(account.id);

      const enrollments = await prisma.tripEnrollment.findMany({
        where: {
          studentId: account.studentId,
          trip: {
            isPublished: true,
            isArchived: false
          }
        },
        include: {
          trip: {
            include: {
              documents: true
            }
          }
        },
        orderBy: [{ trip: { dueAt: 'asc' } }]
      });

      const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
      const paidByEnrollment = new Map<string, number>();

      if (enrollmentIds.length > 0) {
        const paidRows = await prisma.tripPayment.groupBy({
          by: ['enrollmentId'],
          where: {
            enrollmentId: { in: enrollmentIds },
            status: 'SUCCEEDED'
          },
          _sum: {
            amountCents: true
          }
        });

        for (const row of paidRows) {
          paidByEnrollment.set(row.enrollmentId, row._sum.amountCents || 0);
        }
      }

      const now = new Date();
      const enrollmentCards = enrollments.map((enrollment) =>
        formatEnrollmentSummary({
          enrollment,
          paidCents: paidByEnrollment.get(enrollment.id) || 0,
          now
        })
      );

      const history = await prisma.tripPayment.findMany({
        where: {
          accountId: account.id
        },
        include: {
          enrollment: {
            include: {
              trip: {
                select: {
                  id: true,
                  title: true,
                  slug: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 150
      });

      reply.send({
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          studentId: account.studentId,
          hasClaimedStudent: true
        },
        student: account.student,
        enrollments: enrollmentCards,
        payments: history.map((payment) => ({
          id: payment.id,
          enrollmentId: payment.enrollmentId,
          tripId: payment.enrollment.trip.id,
          tripTitle: payment.enrollment.trip.title,
          tripSlug: payment.enrollment.trip.slug,
          amountCents: payment.amountCents,
          currency: payment.currency,
          status: payment.status,
          paidAt: payment.paidAt,
          createdAt: payment.createdAt,
          stripePaymentIntentId: payment.stripePaymentIntentId
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load trip dashboard');
    }
  });

  app.get('/api/trips/portal/payments/history', { preHandler: app.authenticateTripAccount }, async (request, reply) => {
    const querySchema = z.object({
      enrollmentId: z.string().trim().min(1).optional()
    });

    const parsedQuery = querySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }

    try {
      const account = await prisma.tripAccount.findUnique({
        where: { id: request.tripAccount!.id },
        select: { id: true, studentId: true, isActive: true }
      });

      if (!account || !account.isActive || !account.studentId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      await reconcilePendingTripPaymentsForAccount(account.id);

      if (parsedQuery.data.enrollmentId) {
        const enrollment = await prisma.tripEnrollment.findUnique({
          where: { id: parsedQuery.data.enrollmentId },
          select: { id: true, studentId: true }
        });
        if (!enrollment || enrollment.studentId !== account.studentId) {
          return reply.status(404).send({ error: 'Enrollment not found' });
        }
      }

      const rows = await prisma.tripPayment.findMany({
        where: {
          accountId: account.id,
          ...(parsedQuery.data.enrollmentId
            ? {
                enrollmentId: parsedQuery.data.enrollmentId
              }
            : {})
        },
        include: {
          enrollment: {
            include: {
              trip: {
                select: {
                  id: true,
                  title: true,
                  slug: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      reply.send({
        payments: rows.map((payment) => ({
          id: payment.id,
          enrollmentId: payment.enrollmentId,
          tripId: payment.enrollment.trip.id,
          tripTitle: payment.enrollment.trip.title,
          tripSlug: payment.enrollment.trip.slug,
          amountCents: payment.amountCents,
          currency: payment.currency,
          status: payment.status,
          paidAt: payment.paidAt,
          createdAt: payment.createdAt,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          stripeCheckoutSessionId: payment.stripeCheckoutSessionId
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load trip payment history');
    }
  });

  app.post('/api/trips/portal/payments/session', { preHandler: app.authenticateTripAccount }, async (request, reply) => {
    const parsed = startPaymentSessionSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const account = await prisma.tripAccount.findUnique({
        where: { id: request.tripAccount!.id },
        select: {
          id: true,
          email: true,
          name: true,
          studentId: true,
          isActive: true,
          stripeCustomerId: true
        }
      });

      if (!account || !account.isActive || !account.studentId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const enrollment = await prisma.tripEnrollment.findUnique({
        where: {
          id: parsed.data.enrollmentId
        },
        include: {
          student: {
            select: {
              id: true,
              name: true
            }
          },
          trip: {
            select: {
              id: true,
              title: true,
              slug: true,
              dueAt: true,
              allowPartialPayments: true,
              isPublished: true,
              isArchived: true
            }
          }
        }
      });

      if (!enrollment || enrollment.studentId !== account.studentId) {
        return reply.status(404).send({ error: 'Enrollment not found' });
      }

      if (!enrollment.trip.isPublished || enrollment.trip.isArchived) {
        return reply.status(400).send({ error: 'Trip is not available for payments' });
      }

      const dueAt = enrollment.dueAtOverride || enrollment.trip.dueAt;
      const now = new Date();
      if (now > dueAt) {
        return reply.status(403).send({ error: 'Payment deadline has passed for this trip' });
      }

      const paidAgg = await prisma.tripPayment.aggregate({
        where: {
          enrollmentId: enrollment.id,
          status: 'SUCCEEDED'
        },
        _sum: {
          amountCents: true
        }
      });

      const paidAmountCents = paidAgg._sum.amountCents || 0;
      const remainingAmountCents = Math.max(0, enrollment.targetAmountCents - paidAmountCents);

      if (remainingAmountCents <= 0) {
        return reply.status(400).send({ error: 'Enrollment is already fully paid' });
      }

      const amountCents = parsed.data.amountCents;
      if (amountCents > remainingAmountCents) {
        return reply.status(400).send({ error: 'Payment amount exceeds remaining balance' });
      }

      if (!enrollment.trip.allowPartialPayments && amountCents !== remainingAmountCents) {
        return reply
          .status(400)
          .send({ error: 'This trip requires one-time full remaining balance payments (partial disabled)' });
      }

      const customerId = await ensureStripeCustomerForTripAccount(account);

      const tripPayment = await prisma.tripPayment.create({
        data: {
          enrollmentId: enrollment.id,
          accountId: account.id,
          amountCents,
          currency: 'usd',
          status: 'PENDING'
        }
      });

      const metadata: Record<string, string> = {
        source: 'trip_payment',
        tripId: enrollment.trip.id,
        enrollmentId: enrollment.id,
        accountId: account.id,
        studentId: enrollment.student.id,
        tripPaymentId: tripPayment.id
      };

      const expiresAtUnix = Math.floor(Math.min(dueAt.getTime(), Date.now() + 24 * 60 * 60 * 1000) / 1000);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'embedded',
        customer: customerId,
        return_url: `${env.APP_BASE_URL}/trip-payments?checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
        client_reference_id: tripPayment.id,
        expires_at: Math.max(expiresAtUnix, Math.floor(Date.now() / 1000) + 60),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amountCents,
              product_data: {
                name: `${enrollment.trip.title} Trip Payment`,
                description: enrollment.student.name
              }
            }
          }
        ],
        metadata,
        payment_intent_data: {
          metadata
        }
      });

      await prisma.tripPayment.update({
        where: { id: tripPayment.id },
        data: {
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null
        }
      });

      reply.status(201).send({
        paymentId: tripPayment.id,
        checkoutSessionId: session.id,
        clientSecret: session.client_secret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
        amountCents,
        remainingAmountCents
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to start trip payment session');
    }
  });
};
