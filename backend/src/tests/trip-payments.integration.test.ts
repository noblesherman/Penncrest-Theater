/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/trip-payments.integration.test.ts`
- What this is: Backend test module.
- What it does: Covers integration/smoke behavior for key backend workflows.
- Connections: Exercises route + service behavior to catch regressions early.
- Main content type: Test setup and assertions.
- Safe edits here: Assertion message clarity and docs comments.
- Be careful with: Changing expectations without confirming intended behavior.
- Useful context: Useful for understanding what the system is supposed to do right now.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type StripeEventEnvelope = {
  id: string;
  type: string;
  data: {
    object: any;
  };
};

type StartPaymentSessionResponse = {
  paymentId: string;
};

type DashboardResponse = {
  enrollments: Array<{
    enrollmentId: string;
    paidAmountCents: number;
    remainingAmountCents: number;
  }>;
};

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

const schemaName = `trip_payments_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run trip payments integration tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_trip_payments';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_trip_payments';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_trip_payments';
process.env.JWT_SECRET = 'trip-payments-test-secret-12345';
process.env.ADMIN_USERNAME = 'trip-admin';
process.env.ADMIN_PASSWORD = 'trip-admin-password';
process.env.TRIP_LOGIN_CODE_TTL_MINUTES = '15';
process.env.TRIP_LOGIN_CODE_MAX_ATTEMPTS = '6';
process.env.TRIP_ACCOUNT_TOKEN_TTL_HOURS = '24';

const emailedCodes = new Map<string, string>();
const stripeState: {
  nextWebhookEvent: StripeEventEnvelope | null;
  checkoutCounter: number;
  paymentIntentCounter: number;
} = {
  nextWebhookEvent: null,
  checkoutCounter: 0,
  paymentIntentCounter: 0
};

vi.mock('../lib/email.js', () => ({
  sendTripLoginCodeEmail: vi.fn(async (payload: { email: string; code: string }) => {
    emailedCodes.set(payload.email, payload.code);
    return undefined;
  }),
  sendTicketsEmail: vi.fn(async () => undefined),
  sendDonationThankYouEmail: vi.fn(async () => undefined),
  sendSeniorSendoffSubmissionEmail: vi.fn(async () => undefined)
}));

vi.mock('../lib/stripe.js', () => ({
  stripe: {
    customers: {
      create: vi.fn(async () => {
        stripeState.paymentIntentCounter += 1;
        return { id: `cus_trip_${stripeState.paymentIntentCounter}` };
      })
    },
    checkout: {
      sessions: {
        create: vi.fn(async (params: any) => {
          stripeState.checkoutCounter += 1;
          const checkoutId = `cs_trip_${stripeState.checkoutCounter}`;
          const paymentIntentId = `pi_trip_${stripeState.checkoutCounter}`;
          return {
            id: checkoutId,
            object: 'checkout.session',
            mode: 'payment',
            ui_mode: 'embedded',
            status: 'open',
            payment_status: 'unpaid',
            payment_intent: paymentIntentId,
            metadata: params.metadata,
            client_secret: `${checkoutId}_secret`
          };
        })
      }
    },
    webhooks: {
      constructEvent: vi.fn(() => {
        if (!stripeState.nextWebhookEvent) {
          throw new Error('No webhook event queued');
        }
        return stripeState.nextWebhookEvent;
      })
    }
  }
}));

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;
let adminToken: string;
let adminId: string;

async function requestAndVerifyTripToken(email: string): Promise<string> {
  const requestCode = await app.inject({
    method: 'POST',
    url: '/api/trip-auth/request-code',
    payload: {
      email,
      name: email.split('@')[0]
    }
  });
  expect(requestCode.statusCode).toBe(200);
  const code = emailedCodes.get(email);
  expect(code).toBeTruthy();

  const verify = await app.inject({
    method: 'POST',
    url: '/api/trip-auth/verify-code',
    payload: {
      email,
      code
    }
  });
  expect(verify.statusCode).toBe(200);
  const body = verify.json() as { token: string };
  return body.token;
}

async function seedTripEnrollment(params: {
  title: string;
  slug: string;
  studentName: string;
  targetAmountCents: number;
  allowPartialPayments?: boolean;
  dueAt?: Date;
}) {
  const trip = await prisma.trip.create({
    data: {
      title: params.title,
      slug: params.slug,
      destination: 'Test Destination',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      dueAt: params.dueAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
      defaultCostCents: params.targetAmountCents,
      allowPartialPayments: Boolean(params.allowPartialPayments),
      isPublished: true,
      isArchived: false
    }
  });

  const student = await prisma.tripStudent.create({
    data: {
      name: params.studentName,
      grade: '10',
      isActive: true
    }
  });

  const enrollment = await prisma.tripEnrollment.create({
    data: {
      tripId: trip.id,
      studentId: student.id,
      targetAmountCents: params.targetAmountCents
    }
  });

  return { trip, student, enrollment };
}

describe.sequential('trip payments portal', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL
      },
      stdio: 'pipe'
    });

    ({ prisma } = await import('../lib/prisma.js'));
    ({ createServer } = await import('../server.js'));
    app = await createServer();

    const admin = await prisma.adminUser.create({
      data: {
        username: 'trip-admin-user',
        name: 'Trip Admin',
        passwordHash: 'not-used',
        role: 'ADMIN',
        isActive: true
      }
    });
    adminId = admin.id;
    adminToken = await app.jwt.sign({
      role: 'admin',
      adminId: admin.id,
      adminRole: admin.role,
      username: admin.username
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    emailedCodes.clear();
    stripeState.nextWebhookEvent = null;
  });

  it('supports email-code auth success, expiry, and single-use', async () => {
    const email = `family_${Date.now()}@example.com`;

    await app.inject({
      method: 'POST',
      url: '/api/trip-auth/request-code',
      payload: {
        email,
        name: 'Family One'
      }
    });

    const code = emailedCodes.get(email);
    expect(code).toBeTruthy();
    const account = await prisma.tripAccount.findUniqueOrThrow({ where: { email } });
    await prisma.tripLoginCode.updateMany({
      where: { accountId: account.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const expiredAttempt = await app.inject({
      method: 'POST',
      url: '/api/trip-auth/verify-code',
      payload: { email, code }
    });
    expect(expiredAttempt.statusCode).toBe(401);

    await app.inject({
      method: 'POST',
      url: '/api/trip-auth/request-code',
      payload: {
        email,
        name: 'Family One'
      }
    });
    const freshCode = emailedCodes.get(email);
    expect(freshCode).toBeTruthy();

    const verified = await app.inject({
      method: 'POST',
      url: '/api/trip-auth/verify-code',
      payload: { email, code: freshCode }
    });
    expect(verified.statusCode).toBe(200);
    expect((verified.json() as { token?: string }).token).toBeTruthy();

    const reused = await app.inject({
      method: 'POST',
      url: '/api/trip-auth/verify-code',
      payload: { email, code: freshCode }
    });
    expect(reused.statusCode).toBe(401);
  });

  it('enforces first-claim-wins and enrollment ownership access', async () => {
    const seeded = await seedTripEnrollment({
      title: 'Claim Race Trip',
      slug: `claim-race-${Date.now()}`,
      studentName: 'Race Student',
      targetAmountCents: 10000,
      allowPartialPayments: true
    });

    const tokenA = await requestAndVerifyTripToken(`a_${Date.now()}@example.com`);
    const tokenB = await requestAndVerifyTripToken(`b_${Date.now()}@example.com`);

    const [claimA, claimB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/trips/portal/claim',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: { studentId: seeded.student.id }
      }),
      app.inject({
        method: 'POST',
        url: '/api/trips/portal/claim',
        headers: { Authorization: `Bearer ${tokenB}` },
        payload: { studentId: seeded.student.id }
      })
    ]);

    const statusSet = new Set([claimA.statusCode, claimB.statusCode]);
    expect(statusSet.has(200)).toBe(true);
    expect(statusSet.has(409)).toBe(true);

    const otherSeed = await seedTripEnrollment({
      title: 'Other Ownership Trip',
      slug: `other-ownership-${Date.now()}`,
      studentName: 'Other Student',
      targetAmountCents: 5000,
      allowPartialPayments: true
    });

    const nonOwnerAttempt = await app.inject({
      method: 'POST',
      url: '/api/trips/portal/payments/session',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        enrollmentId: otherSeed.enrollment.id,
        amountCents: 500
      }
    });
    expect(nonOwnerAttempt.statusCode).toBe(404);
  });

  it('processes partial payments and webhook idempotency without double-recording', async () => {
    const seeded = await seedTripEnrollment({
      title: 'Partial Payment Trip',
      slug: `partial-pay-${Date.now()}`,
      studentName: 'Partial Student',
      targetAmountCents: 10000,
      allowPartialPayments: true
    });
    const token = await requestAndVerifyTripToken(`partial_${Date.now()}@example.com`);

    const claim = await app.inject({
      method: 'POST',
      url: '/api/trips/portal/claim',
      headers: { Authorization: `Bearer ${token}` },
      payload: { studentId: seeded.student.id }
    });
    expect(claim.statusCode).toBe(200);

    const session = await app.inject({
      method: 'POST',
      url: '/api/trips/portal/payments/session',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        enrollmentId: seeded.enrollment.id,
        amountCents: 3000
      }
    });
    expect(session.statusCode).toBe(201);
    const sessionBody = session.json() as StartPaymentSessionResponse;
    const payment = await prisma.tripPayment.findUniqueOrThrow({ where: { id: sessionBody.paymentId } });

    stripeState.nextWebhookEvent = {
      id: 'evt_trip_idempotent_payment_succeeded',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.stripePaymentIntentId,
          metadata: {
            source: 'trip_payment',
            tripId: seeded.trip.id,
            enrollmentId: seeded.enrollment.id,
            accountId: payment.accountId,
            studentId: seeded.student.id,
            tripPaymentId: payment.id
          }
        }
      }
    };

    const firstWebhook = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_trip_1',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });
    expect(firstWebhook.statusCode).toBe(200);

    const duplicateWebhook = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_trip_1_repeat',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });
    expect(duplicateWebhook.statusCode).toBe(200);

    const refreshedPayment = await prisma.tripPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(refreshedPayment.status).toBe('SUCCEEDED');

    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/trips/portal/dashboard',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(dashboard.statusCode).toBe(200);
    const dashboardBody = dashboard.json() as DashboardResponse;
    const enrollmentCard = dashboardBody.enrollments.find((row) => row.enrollmentId === seeded.enrollment.id);
    expect(enrollmentCard?.paidAmountCents).toBe(3000);
    expect(enrollmentCard?.remainingAmountCents).toBe(7000);
  });

  it('enforces hard cutoff, allows admin due override, and recalculates remaining after target override', async () => {
    const seeded = await seedTripEnrollment({
      title: 'Due Date Override Trip',
      slug: `due-override-${Date.now()}`,
      studentName: 'Due Student',
      targetAmountCents: 12000,
      allowPartialPayments: false,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    const token = await requestAndVerifyTripToken(`due_${Date.now()}@example.com`);

    await app.inject({
      method: 'POST',
      url: '/api/trips/portal/claim',
      headers: { Authorization: `Bearer ${token}` },
      payload: { studentId: seeded.student.id }
    });

    await prisma.tripEnrollment.update({
      where: { id: seeded.enrollment.id },
      data: { dueAtOverride: new Date(Date.now() - 1000) }
    });

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/trips/portal/payments/session',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        enrollmentId: seeded.enrollment.id,
        amountCents: 12000
      }
    });
    expect(blocked.statusCode).toBe(403);

    const overrideDue = await app.inject({
      method: 'PATCH',
      url: `/api/admin/trips/enrollments/${seeded.enrollment.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        dueAtOverride: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        reason: 'Exception approved'
      }
    });
    expect(overrideDue.statusCode).toBe(200);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/trips/portal/payments/session',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        enrollmentId: seeded.enrollment.id,
        amountCents: 12000
      }
    });
    expect(allowed.statusCode).toBe(201);
    const allowedBody = allowed.json() as StartPaymentSessionResponse;
    const payment = await prisma.tripPayment.findUniqueOrThrow({ where: { id: allowedBody.paymentId } });

    stripeState.nextWebhookEvent = {
      id: 'evt_trip_due_override_paid',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.stripePaymentIntentId,
          metadata: {
            source: 'trip_payment',
            tripId: seeded.trip.id,
            enrollmentId: seeded.enrollment.id,
            accountId: payment.accountId,
            studentId: seeded.student.id,
            tripPaymentId: payment.id
          }
        }
      }
    };
    const webhook = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_trip_due_override',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });
    expect(webhook.statusCode).toBe(200);

    const targetOverride = await app.inject({
      method: 'PATCH',
      url: `/api/admin/trips/enrollments/${seeded.enrollment.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        targetAmountCents: 14000,
        reason: 'Aid adjustment'
      }
    });
    expect(targetOverride.statusCode).toBe(200);

    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/trips/portal/dashboard',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(dashboard.statusCode).toBe(200);
    const card = (dashboard.json() as DashboardResponse).enrollments.find((row) => row.enrollmentId === seeded.enrollment.id);
    expect(card?.paidAmountCents).toBe(12000);
    expect(card?.remainingAmountCents).toBe(2000);

    const adjustments = await prisma.tripBalanceAdjustment.findMany({
      where: { enrollmentId: seeded.enrollment.id }
    });
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments[0].actorAdminId).toBe(adminId);
  });
});
