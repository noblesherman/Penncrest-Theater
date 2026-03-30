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
        customerName: 'Jordan Buyer'
      }
    });

    expect(checkoutResponse.statusCode).toBe(200);
    expect(checkoutResponse.json().clientSecret).toContain('pi_smoke_');
    expect(checkoutResponse.json().orderId).toBeTruthy();

    const order = await prisma.order.findFirstOrThrow({
      where: {
        email: buyerEmail
      }
    });

    expect(order.status).toBe('PENDING');
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

    const confirmationResponse = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.id}?token=${encodeURIComponent(order.accessToken)}`
    });

    expect(confirmationResponse.statusCode).toBe(200);
    const confirmationBody = confirmationResponse.json();
    expect(confirmationBody.order.status).toBe('PAID');
    expect(confirmationBody.tickets).toHaveLength(1);
    const ticketPublicId = confirmationBody.tickets[0]?.publicId;
    expect(ticketPublicId).toBeTruthy();

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
        customerName: 'Recovery Buyer'
      }
    });

    expect(checkoutResponse.statusCode).toBe(200);

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
    expect(recoveredOrder.lastFinalizationError).toContain('Unable to finalize');
    expect(recoveredOrder.stripeRefundStatus).toBe('pending');
    expect(recoveredOrder.refundRequestedAt).not.toBeNull();
  });
});
