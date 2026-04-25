/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/critical-lifecycle.smoke.test.ts`
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

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

const schemaName = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend smoke tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_smoke';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_smoke';
process.env.JWT_SECRET = 'smoke-test-secret-12345';
process.env.ADMIN_USERNAME = 'smoke-admin';
process.env.ADMIN_PASSWORD = 'smoke-admin-password';

const stripeState: {
  nextWebhookEvent: StripeEventEnvelope | null;
  latestCheckoutSession: any | null;
  latestPaymentIntent: any | null;
  latestCheckoutAmount: number;
  refundStatus: 'succeeded' | 'pending';
  refundCounter: number;
  paymentIntentCounter: number;
} = {
  nextWebhookEvent: null,
  latestCheckoutSession: null,
  latestPaymentIntent: null,
  latestCheckoutAmount: 0,
  refundStatus: 'succeeded',
  refundCounter: 0,
  paymentIntentCounter: 0
};

vi.mock('../lib/stripe.js', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(async (params: any) => {
        stripeState.paymentIntentCounter += 1;
        stripeState.latestCheckoutAmount = params.amount || 0;

        const paymentIntentId = `pi_smoke_${stripeState.paymentIntentCounter}`;
        const paymentIntent = {
          id: paymentIntentId,
          object: 'payment_intent',
          client_secret: `${paymentIntentId}_secret_smoke`,
          status: 'requires_payment_method',
          metadata: params.metadata || {}
        };

        stripeState.latestPaymentIntent = paymentIntent;
        return paymentIntent;
      }),
      retrieve: vi.fn(async (paymentIntentId: string) => {
        if (stripeState.latestPaymentIntent?.id !== paymentIntentId) {
          throw new Error(`Unknown payment intent: ${paymentIntentId}`);
        }

        return stripeState.latestPaymentIntent;
      })
    },
    checkout: {
      sessions: {
        create: vi.fn(async (params: any) => {
          stripeState.paymentIntentCounter += 1;
          stripeState.latestCheckoutAmount = (params.line_items || []).reduce((sum: number, item: any) => {
            return sum + (item.quantity || 0) * (item.price_data?.unit_amount || 0);
          }, 0);

          const sessionId = `cs_smoke_${stripeState.paymentIntentCounter}`;
          const paymentIntentId = `pi_smoke_${stripeState.paymentIntentCounter}`;
          const session = {
            id: sessionId,
            object: 'checkout.session',
            url: `https://stripe.test/${sessionId}`,
            payment_intent: paymentIntentId,
            status: 'open',
            payment_status: 'unpaid',
            metadata: params.metadata || {}
          };

          stripeState.latestCheckoutSession = {
            ...session,
            status: 'complete',
            payment_status: 'paid'
          };

          return session;
        }),
        retrieve: vi.fn(async (sessionId: string) => {
          if (stripeState.latestCheckoutSession?.id !== sessionId) {
            throw new Error(`Unknown checkout session: ${sessionId}`);
          }

          return stripeState.latestCheckoutSession;
        })
      }
    },
    refunds: {
      create: vi.fn(async (params: any) => {
        stripeState.refundCounter += 1;
        return {
          id: `re_smoke_${stripeState.refundCounter}`,
          object: 'refund',
          amount: stripeState.latestCheckoutAmount,
          status: stripeState.refundStatus,
          metadata: params.metadata || {},
          created: Math.floor(Date.now() / 1000),
          failure_reason: null
        };
      })
    },
    webhooks: {
      constructEvent: vi.fn(() => {
        if (!stripeState.nextWebhookEvent) {
          throw new Error('No webhook event queued for test');
        }

        return stripeState.nextWebhookEvent;
      })
    }
  }
}));

vi.mock('../lib/email.js', () => ({
  sendTicketsEmail: vi.fn(async () => undefined)
}));

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;
let adminToken: string;
let adminUserId: string;
let expireStalePendingCheckoutAttempts: typeof import('../services/checkout-attempt-service.js').expireStalePendingCheckoutAttempts;

async function runPaidCheckout(params: {
  performanceId: string;
  seatIds: string[];
  holdToken: string;
  clientToken: string;
  customerEmail: string;
  customerName: string;
  donationAmountCents?: number;
}): Promise<{
  orderId: string;
  clientSecret?: string;
  orderAccessToken?: string;
}> {
  const checkoutResponse = await app.inject({
    method: 'POST',
    url: '/api/checkout',
    payload: {
      performanceId: params.performanceId,
      checkoutMode: 'PAID',
      seatIds: params.seatIds,
      holdToken: params.holdToken,
      clientToken: params.clientToken,
      customerEmail: params.customerEmail,
      customerName: params.customerName,
      customerPhone: '610-555-0101',
      donationAmountCents: params.donationAmountCents
    }
  });

  expect(checkoutResponse.statusCode).toBe(200);
  const checkoutBody = checkoutResponse.json();

  if (checkoutBody?.status !== 'QUEUED') {
    return checkoutBody;
  }

  const queueId = String(checkoutBody.queueId || '');
  expect(queueId).toBeTruthy();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const statusResponse = await app.inject({
      method: 'GET',
      url: `/api/checkout/queue/${encodeURIComponent(queueId)}?holdToken=${encodeURIComponent(params.holdToken)}&clientToken=${encodeURIComponent(params.clientToken)}`
    });

    expect(statusResponse.statusCode).toBe(200);
    const statusBody = statusResponse.json();

    if (statusBody?.status === 'READY') {
      return statusBody;
    }

    if (statusBody?.status === 'FAILED' || statusBody?.status === 'EXPIRED') {
      throw new Error(`Queued checkout did not complete: ${statusBody.status} (${statusBody.reason || 'unknown'})`);
    }

    const refreshDelayMs = Math.max(25, Math.min(250, Number(statusBody?.refreshAfterMs || 50)));
    await new Promise((resolve) => setTimeout(resolve, refreshDelayMs));
  }

  throw new Error('Timed out waiting for queued checkout to become READY');
}

async function createPerformance(title: string, emailSeed: string) {
  const show = await prisma.show.create({
    data: {
      title: `${title} Show`,
      description: 'Smoke test show'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      title,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      salesCutoffAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
      venue: 'Smoke Test Theater',
      notes: emailSeed
    }
  });

  const seat = await prisma.seat.create({
    data: {
      performanceId: performance.id,
      row: 'A',
      number: 1,
      sectionName: 'Orchestra',
      x: 10,
      y: 10,
      price: 2500
    }
  });

  return { performance, seat };
}

describe.sequential('critical lifecycle smoke', () => {
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
    ({ expireStalePendingCheckoutAttempts } = await import('../services/checkout-attempt-service.js'));
    app = await createServer();

    const adminUser = await prisma.adminUser.create({
      data: {
        username: 'smoke-admin',
        name: 'Smoke Admin',
        passwordHash: 'not-used-in-test',
        role: 'ADMIN',
        isActive: true
      }
    });

    adminUserId = adminUser.id;
    adminToken = await app.jwt.sign({
      role: 'admin',
      adminId: adminUser.id,
      adminRole: adminUser.role,
      username: adminUser.username
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    stripeState.nextWebhookEvent = null;
    stripeState.latestCheckoutSession = null;
    stripeState.latestPaymentIntent = null;
    stripeState.latestCheckoutAmount = 0;
    stripeState.refundStatus = 'succeeded';
  });

  it('completes hold -> checkout -> webhook finalization -> confirmation -> scan -> duplicate -> refund', async () => {
    const buyerEmail = `buyer_${Date.now()}@example.com`;
    const clientToken = `client_${Date.now()}_abc123`;
    const { performance, seat } = await createPerformance('Smoke Lifecycle', buyerEmail);

    const holdResponse = await app.inject({
      method: 'POST',
      url: '/api/hold',
      payload: {
        performanceId: performance.id,
        seatIds: [seat.id],
        clientToken
      }
    });

    expect(holdResponse.statusCode).toBe(200);
    const holdBody = holdResponse.json();
    expect(holdBody.heldSeatIds).toEqual([seat.id]);

    const checkoutResult = await runPaidCheckout({
      performanceId: performance.id,
      seatIds: [seat.id],
      holdToken: holdBody.holdToken,
      clientToken,
      customerEmail: buyerEmail,
      customerName: 'Jordan Buyer'
    });

    expect(checkoutResult.clientSecret).toContain('pi_smoke_');
    expect(checkoutResult.orderId).toBeTruthy();
    expect(stripeState.latestCheckoutAmount).toBe(2500);
    expect(stripeState.latestPaymentIntent?.metadata?.donationAmountCents).toBe('0');

    const order = await prisma.order.findFirstOrThrow({
      where: {
        email: buyerEmail
      }
    });

    expect(order.status).toBe('PENDING');
    expect(order.amountTotal).toBe(2500);
    expect(order.donationAmountCents).toBe(0);
    expect(order.checkoutAttemptState).toBe('AWAITING_PAYMENT');
    expect(order.checkoutAttemptExpiresAt).toBeTruthy();
    expect(order.accessToken).toBeTruthy();

    stripeState.nextWebhookEvent = {
      id: 'evt_smoke_checkout_completed',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          ...stripeState.latestPaymentIntent,
          status: 'succeeded'
        }
      }
    };

    const webhookResponse = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_smoke',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });

    expect(webhookResponse.statusCode).toBe(200);

    const duplicateWebhookResponse = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_smoke_duplicate',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });

    expect(duplicateWebhookResponse.statusCode).toBe(200);

    const webhookLedgerRows = await prisma.$queryRaw<Array<{ status: string; processedAt: Date | null }>>`
      SELECT "status", "processedAt"
      FROM "StripeWebhookEvent"
      WHERE "eventId" = ${'evt_smoke_checkout_completed'}
      LIMIT 1
    `;
    const webhookLedgerEvent = webhookLedgerRows[0];

    expect(webhookLedgerEvent).toBeTruthy();
    if (!webhookLedgerEvent) {
      throw new Error('Expected Stripe webhook ledger row to exist');
    }

    expect(webhookLedgerEvent.status).toBe('PROCESSED');
    expect(webhookLedgerEvent.processedAt).not.toBeNull();

    const dedupedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id }
    });

    expect(dedupedOrder.finalizationAttemptCount).toBe(1);
    expect(dedupedOrder.amountTotal).toBe(2500);
    expect(dedupedOrder.donationAmountCents).toBe(0);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(1);

    const confirmationResponse = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.id}?token=${encodeURIComponent(order.accessToken)}`
    });

    expect(confirmationResponse.statusCode).toBe(200);
    const confirmationBody = confirmationResponse.json();
    expect(confirmationBody.order.status).toBe('PAID');
    expect(confirmationBody.tickets).toHaveLength(1);
    expect(confirmationBody.tickets[0]?.checkedInAt).toBeNull();
    expect(confirmationBody.tickets[0]?.checkedInBy).toBeNull();
    const ticketPublicId = confirmationBody.tickets[0]?.publicId;
    expect(ticketPublicId).toBeTruthy();

    const lookupResponse = await app.inject({
      method: 'POST',
      url: '/api/orders/lookup',
      payload: {
        orderId: order.id,
        email: buyerEmail
      }
    });

    expect(lookupResponse.statusCode).toBe(200);
    const lookupBody = lookupResponse.json();
    expect(lookupBody.orderAccessToken).toBe(order.accessToken);
    expect(lookupBody.tickets[0]?.checkedInAt).toBeNull();
    expect(lookupBody.tickets[0]?.checkedInBy).toBeNull();

    const lookupInvalidEmailResponse = await app.inject({
      method: 'POST',
      url: '/api/orders/lookup',
      payload: {
        orderId: order.id,
        email: `wrong_${buyerEmail}`
      }
    });

    expect(lookupInvalidEmailResponse.statusCode).toBe(404);

    const sessionStartResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/check-in/session/start',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        performanceId: performance.id,
        staffName: 'Gate Staff',
        gate: 'Main Entrance'
      }
    });

    expect(sessionStartResponse.statusCode).toBe(200);
    const sessionBody = sessionStartResponse.json();

    const firstScanResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/check-in/scan',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        performanceId: performance.id,
        sessionToken: sessionBody.sessionToken,
        scannedValue: ticketPublicId,
        clientScanId: 'scan_smoke_1'
      }
    });

    expect(firstScanResponse.statusCode).toBe(200);
    expect(firstScanResponse.json().outcome).toBe('VALID');

    const checkedInConfirmationResponse = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.id}?token=${encodeURIComponent(order.accessToken)}`
    });
    expect(checkedInConfirmationResponse.statusCode).toBe(200);
    const checkedInConfirmationBody = checkedInConfirmationResponse.json();
    expect(checkedInConfirmationBody.tickets[0]?.checkedInAt).toBeTruthy();
    expect(checkedInConfirmationBody.tickets[0]?.checkedInBy).toBeTruthy();

    const duplicateScanResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/check-in/scan',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        performanceId: performance.id,
        sessionToken: sessionBody.sessionToken,
        scannedValue: ticketPublicId,
        clientScanId: 'scan_smoke_2'
      }
    });

    expect(duplicateScanResponse.statusCode).toBe(200);
    expect(duplicateScanResponse.json().outcome).toBe('ALREADY_CHECKED_IN');

    const analyticsResponse = await app.inject({
      method: 'GET',
      url: `/api/admin/check-in/analytics?performanceId=${encodeURIComponent(performance.id)}`,
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    });

    expect(analyticsResponse.statusCode).toBe(200);
    const analyticsBody = analyticsResponse.json();
    expect(analyticsBody.performance.id).toBe(performance.id);
    expect(analyticsBody.totals.totalAdmittable).toBe(1);
    expect(analyticsBody.totals.totalCheckedIn).toBe(1);
    expect(analyticsBody.totals.noShowEstimate).toBe(0);
    expect(analyticsBody.attempts.duplicateAttempts).toBe(1);
    expect(analyticsBody.attempts.invalidQrAttempts).toBe(0);
    expect(analyticsBody.attempts.notFoundAttempts).toBe(0);
    expect(analyticsBody.attempts.wrongPerformanceAttempts).toBe(0);
    expect(analyticsBody.attempts.notAdmittedAttempts).toBe(0);
    expect(analyticsBody.attempts.fraudAttemptEstimate).toBe(0);
    expect(analyticsBody.supervisorDecisions.forceAdmitCount).toBe(0);
    expect(analyticsBody.supervisorDecisions.denyCount).toBe(0);
    expect(analyticsBody.peakPerMinute).toBe(1);
    expect(analyticsBody.byGate).toEqual([{ gate: 'Main Entrance', count: 1 }]);
    expect(analyticsBody.timeline).toHaveLength(1);
    expect(analyticsBody.timeline[0]?.count).toBe(1);
    expect(analyticsBody.timeline[0]?.minute).toBeTruthy();

    const refundResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/${order.id}/refund`,
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        releaseSeats: true,
        reason: 'Smoke refund'
      }
    });

    expect(refundResponse.statusCode).toBe(200);
    expect(refundResponse.json().refundOutcome).toBe('succeeded');

    const refundedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        orderSeats: true
      }
    });

    const refundedSeat = await prisma.seat.findUniqueOrThrow({
      where: { id: seat.id }
    });

    expect(refundedOrder.status).toBe('REFUNDED');
    expect(refundedOrder.stripeRefundStatus).toBe('succeeded');
    expect(refundedOrder.refundAmountCents).toBe(refundedOrder.amountTotal);
    expect(refundedSeat.status).toBe('AVAILABLE');
  });

  it('adds an optional checkout donation to Stripe amount and preserves it through finalization', async () => {
    const buyerEmail = `donor_${Date.now()}@example.com`;
    const clientToken = `client_${Date.now()}_donation`;
    const { performance, seat } = await createPerformance('Donation Checkout', buyerEmail);

    const holdResponse = await app.inject({
      method: 'POST',
      url: '/api/hold',
      payload: {
        performanceId: performance.id,
        seatIds: [seat.id],
        clientToken
      }
    });

    expect(holdResponse.statusCode).toBe(200);
    const holdBody = holdResponse.json();

    const checkoutResult = await runPaidCheckout({
      performanceId: performance.id,
      seatIds: [seat.id],
      holdToken: holdBody.holdToken,
      clientToken,
      customerEmail: buyerEmail,
      customerName: 'Donation Buyer',
      donationAmountCents: 175
    });

    expect(checkoutResult.orderId).toBeTruthy();
    expect(stripeState.latestCheckoutAmount).toBe(2675);
    expect(stripeState.latestPaymentIntent?.metadata?.ticketSubtotalCents).toBe('2500');
    expect(stripeState.latestPaymentIntent?.metadata?.donationAmountCents).toBe('175');

    const pendingOrder = await prisma.order.findUniqueOrThrow({
      where: { id: checkoutResult.orderId }
    });
    expect(pendingOrder.amountTotal).toBe(2675);
    expect(pendingOrder.donationAmountCents).toBe(175);

    stripeState.nextWebhookEvent = {
      id: 'evt_smoke_checkout_donation',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          ...stripeState.latestPaymentIntent,
          status: 'succeeded'
        }
      }
    };

    const webhookResponse = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_donation',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });

    expect(webhookResponse.statusCode).toBe(200);

    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { id: checkoutResult.orderId },
      include: { orderSeats: true }
    });
    expect(paidOrder.status).toBe('PAID');
    expect(paidOrder.orderSeats.reduce((sum, orderSeat) => sum + orderSeat.price, 0)).toBe(2500);
    expect(paidOrder.amountTotal).toBe(2675);
    expect(paidOrder.donationAmountCents).toBe(175);

    const confirmationResponse = await app.inject({
      method: 'GET',
      url: `/api/orders/${paidOrder.id}?token=${encodeURIComponent(paidOrder.accessToken)}`
    });

    expect(confirmationResponse.statusCode).toBe(200);
    const confirmationBody = confirmationResponse.json();
    expect(confirmationBody.order.amountTotal).toBe(2675);
    expect(confirmationBody.order.ticketSubtotalCents).toBe(2500);
    expect(confirmationBody.order.donationAmountCents).toBe(175);
  });

  it('rejects invalid checkout donation amounts', async () => {
    const buyerEmail = `invalid_donor_${Date.now()}@example.com`;
    const clientToken = `client_${Date.now()}_bad_donation`;
    const { performance, seat } = await createPerformance('Invalid Donation Checkout', buyerEmail);

    const holdResponse = await app.inject({
      method: 'POST',
      url: '/api/hold',
      payload: {
        performanceId: performance.id,
        seatIds: [seat.id],
        clientToken
      }
    });

    const holdBody = holdResponse.json();
    const checkoutResponse = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      payload: {
        performanceId: performance.id,
        checkoutMode: 'PAID',
        seatIds: [seat.id],
        holdToken: holdBody.holdToken,
        clientToken,
        customerEmail: buyerEmail,
        customerName: 'Invalid Donation Buyer',
        customerPhone: '610-555-0101',
        donationAmountCents: 100001
      }
    });

    expect(checkoutResponse.statusCode).toBe(400);
  });

  it('expires stale pending checkout attempts and releases the hold', async () => {
    const buyerEmail = `stale_${Date.now()}@example.com`;
    const clientToken = `client_${Date.now()}_stale`;
    const { performance, seat } = await createPerformance('Stale Checkout', buyerEmail);

    const holdResponse = await app.inject({
      method: 'POST',
      url: '/api/hold',
      payload: {
        performanceId: performance.id,
        seatIds: [seat.id],
        clientToken
      }
    });

    expect(holdResponse.statusCode).toBe(200);
    const holdBody = holdResponse.json();

    const checkoutBody = await runPaidCheckout({
      performanceId: performance.id,
      seatIds: [seat.id],
      holdToken: holdBody.holdToken,
      clientToken,
      customerEmail: buyerEmail,
      customerName: 'Stale Buyer'
    });

    await prisma.order.update({
      where: { id: checkoutBody.orderId },
      data: {
        checkoutAttemptExpiresAt: new Date(Date.now() - 60_000)
      }
    });

    const expired = await expireStalePendingCheckoutAttempts();
    expect(expired).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: checkoutBody.orderId }
    });
    expect(order.status).toBe('CANCELED');
    expect(order.checkoutAttemptState).toBe('EXPIRED');
    expect(order.checkoutAttemptExpiresAt).toBeNull();

    const refreshedSeat = await prisma.seat.findUniqueOrThrow({
      where: { id: seat.id }
    });
    expect(refreshedSeat.status).toBe('AVAILABLE');
    expect(refreshedSeat.holdSessionId).toBeNull();
  });

  it('marks a paid checkout for recovery and requests a refund when finalization cannot safely complete', async () => {
    stripeState.refundStatus = 'pending';

    const buyerEmail = `recover_${Date.now()}@example.com`;
    const clientToken = `client_${Date.now()}_recover`;
    const { performance, seat } = await createPerformance('Recovery Path', buyerEmail);

    const holdResponse = await app.inject({
      method: 'POST',
      url: '/api/hold',
      payload: {
        performanceId: performance.id,
        seatIds: [seat.id],
        clientToken
      }
    });

    const holdBody = holdResponse.json();

    await runPaidCheckout({
      performanceId: performance.id,
      seatIds: [seat.id],
      holdToken: holdBody.holdToken,
      clientToken,
      customerEmail: buyerEmail,
      customerName: 'Recovery Buyer'
    });

    const order = await prisma.order.findFirstOrThrow({
      where: {
        email: buyerEmail
      }
    });

    await prisma.seat.update({
      where: { id: seat.id },
      data: {
        status: 'SOLD',
        holdSessionId: null
      }
    });

    stripeState.nextWebhookEvent = {
      id: 'evt_smoke_checkout_conflict',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          ...stripeState.latestPaymentIntent,
          status: 'succeeded'
        }
      }
    };

    const webhookResponse = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'stripe-signature': 'sig_recovery',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ ok: true })
    });

    expect(webhookResponse.statusCode).toBe(200);

    const recoveredOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id }
    });

    expect(recoveredOrder.status).toBe('FINALIZATION_FAILED');
    expect(recoveredOrder.lastFinalizationError).toContain('We could not finalize');
    expect(recoveredOrder.stripeRefundStatus).toBe('pending');
    expect(recoveredOrder.refundRequestedAt).not.toBeNull();
  });
});
