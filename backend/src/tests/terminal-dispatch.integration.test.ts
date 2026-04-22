/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/terminal-dispatch.integration.test.ts`
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

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

const schemaName = `terminal_dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_terminal_dispatch';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_terminal_dispatch';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_terminal_dispatch';
process.env.JWT_SECRET = 'terminal-dispatch-secret-12345';
process.env.ADMIN_USERNAME = 'terminal-admin';
process.env.ADMIN_PASSWORD = 'terminal-admin-password';
process.env.TERMINAL_DISPATCH_HOLD_TTL_MINUTES = '5';
process.env.ENABLE_IN_PROCESS_PAYMENT_LINE_WORKER = 'false';

type MockPaymentIntent = {
  id: string;
  object: 'payment_intent';
  client_secret: string;
  status: string;
  metadata: Record<string, string>;
  amount: number;
  amount_received: number;
  currency: string;
};

const stripeState: {
  paymentIntents: Map<string, MockPaymentIntent>;
  paymentIntentCounter: number;
} = {
  paymentIntents: new Map(),
  paymentIntentCounter: 0
};

vi.mock('../lib/stripe.js', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(async (params: any) => {
        stripeState.paymentIntentCounter += 1;
        const id = `pi_terminal_${stripeState.paymentIntentCounter}`;
        const paymentIntent: MockPaymentIntent = {
          id,
          object: 'payment_intent',
          client_secret: `${id}_secret_terminal`,
          status: 'requires_payment_method',
          metadata: params.metadata || {},
          amount: params.amount || 0,
          amount_received: 0,
          currency: params.currency || 'usd'
        };
        stripeState.paymentIntents.set(id, paymentIntent);
        return paymentIntent;
      }),
      retrieve: vi.fn(async (paymentIntentId: string) => {
        const paymentIntent = stripeState.paymentIntents.get(paymentIntentId);
        if (!paymentIntent) {
          throw new Error(`Unknown payment intent: ${paymentIntentId}`);
        }
        return paymentIntent;
      })
    },
    terminal: {
      connectionTokens: {
        create: vi.fn(async () => ({ secret: 'tok_terminal_test' }))
      }
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: 'cs_unused', url: 'https://example.com', payment_intent: 'pi_unused' })),
        retrieve: vi.fn(async () => ({ id: 'cs_unused', status: 'complete', payment_status: 'paid', metadata: {} }))
      }
    },
    refunds: {
      create: vi.fn(async () => ({ id: 're_unused', status: 'succeeded' }))
    },
    webhooks: {
      constructEvent: vi.fn(() => ({ id: 'evt_unused', type: 'payment_intent.succeeded', data: { object: {} } }))
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

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${adminToken}`
  };
}

async function createPerformanceFixture(params?: { seatCount?: number; tierPriceCents?: number }) {
  const seatCount = params?.seatCount ?? 2;
  const tierPriceCents = params?.tierPriceCents ?? 2500;

  const show = await prisma.show.create({
    data: {
      title: `Terminal Dispatch Show ${Date.now()}`,
      description: 'Terminal dispatch integration test show'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      title: `Performance ${Date.now()}`,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      salesCutoffAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
      venue: 'Integration Theater'
    }
  });

  const tier = await prisma.pricingTier.create({
    data: {
      performanceId: performance.id,
      name: 'Adult',
      priceCents: tierPriceCents
    }
  });

  const seats = [] as Array<{ id: string; sectionName: string; row: string; number: number }>;
  for (let index = 0; index < seatCount; index += 1) {
    const seat = await prisma.seat.create({
      data: {
        performanceId: performance.id,
        row: 'A',
        number: index + 1,
        sectionName: 'Orchestra',
        x: 10 + index * 10,
        y: 10,
        price: tierPriceCents
      }
    });

    seats.push({
      id: seat.id,
      sectionName: seat.sectionName,
      row: seat.row,
      number: seat.number
    });
  }

  return { performance, tier, seats };
}

async function registerDevice(deviceId: string, terminalName: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/mobile/terminal/device/register',
    headers: authHeaders(),
    payload: {
      deviceId,
      terminalName
    }
  });

  expect(response.statusCode).toBe(200);
}

function buildTicketSelection(seatIds: string[], tierId: string): Record<string, string> {
  return Object.fromEntries(seatIds.map((seatId) => [seatId, tierId]));
}

function markPaymentIntentSucceeded(paymentIntentId: string): void {
  const paymentIntent = stripeState.paymentIntents.get(paymentIntentId);
  if (!paymentIntent) {
    throw new Error(`Payment intent not found: ${paymentIntentId}`);
  }

  paymentIntent.status = 'succeeded';
  paymentIntent.amount_received = paymentIntent.amount;
  stripeState.paymentIntents.set(paymentIntentId, paymentIntent);
}

describe.sequential('terminal dispatch integration', () => {
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
        username: 'terminal-admin',
        name: 'Terminal Admin',
        passwordHash: 'not-used-in-test',
        role: 'ADMIN',
        isActive: true
      }
    });

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
    stripeState.paymentIntents.clear();
  });

  it('creates hold + payment intent + pending dispatch when sending to active device', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1 });
    const deviceId = `device_send_${Date.now()}`;
    await registerDevice(deviceId, 'Lobby iPhone');

    const seatIds = fixture.seats.map((seat) => seat.id);
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds,
        ticketSelectionBySeatId: buildTicketSelection(seatIds, fixture.tier.id),
        customerName: 'Walk Up',
        deviceId
      }
    });

    expect(sendResponse.statusCode).toBe(201);
    const sendBody = sendResponse.json();
    expect(sendBody.status).toBe('PENDING');
    expect(sendBody.targetDeviceId).toBe(deviceId);

    const dispatch = await prisma.terminalPaymentDispatch.findUniqueOrThrow({
      where: { id: sendBody.dispatchId }
    });
    expect(dispatch.status).toBe('PENDING');
    expect(dispatch.stripePaymentIntentId).toBeTruthy();

    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatIds[0] } });
    expect(seat.status).toBe('HELD');
    expect(seat.holdSessionId).toBeTruthy();

    const hold = await prisma.holdSession.findUniqueOrThrow({ where: { holdToken: dispatch.holdToken } });
    expect(hold.status).toBe('ACTIVE');
    expect(hold.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('enqueues multiple sales to the same payment phone queue', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 2 });
    const deviceId = `device_busy_${Date.now()}`;
    await registerDevice(deviceId, 'Busy iPhone');

    const firstSeat = fixture.seats[0]!.id;
    const secondSeat = fixture.seats[1]!.id;

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [firstSeat],
        ticketSelectionBySeatId: buildTicketSelection([firstSeat], fixture.tier.id),
        deviceId
      }
    });
    expect(firstResponse.statusCode).toBe(201);

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [secondSeat],
        ticketSelectionBySeatId: buildTicketSelection([secondSeat], fixture.tier.id),
        deviceId
      }
    });

    expect(secondResponse.statusCode).toBe(201);

    const firstDispatchId = firstResponse.json().dispatchId as string;
    const secondDispatchId = secondResponse.json().dispatchId as string;
    expect(firstDispatchId).not.toBe(secondDispatchId);

    const snapshotResponse = await app.inject({
      method: 'GET',
      url: `/api/admin/payment-line/snapshot?queueKey=${encodeURIComponent(deviceId)}`,
      headers: authHeaders()
    });

    expect(snapshotResponse.statusCode).toBe(200);
    const snapshotBody = snapshotResponse.json();
    expect(snapshotBody.entries).toHaveLength(2);
    expect(snapshotBody.entries[0].entryId).toBe(firstDispatchId);
    expect(snapshotBody.entries[1].entryId).toBe(secondDispatchId);
  });

  it('next-dispatch only returns rows targeted to that device', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1 });
    const deviceA = `device_a_${Date.now()}`;
    const deviceB = `device_b_${Date.now()}`;
    await registerDevice(deviceA, 'Target iPhone');
    await registerDevice(deviceB, 'Other iPhone');

    const seatId = fixture.seats[0]!.id;
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        deviceId: deviceA
      }
    });
    expect(sendResponse.statusCode).toBe(201);
    const dispatchId = sendResponse.json().dispatchId as string;

    const wrongDevice = await app.inject({
      method: 'POST',
      url: '/api/mobile/terminal/dispatch/next',
      headers: authHeaders(),
      payload: { deviceId: deviceB, waitMs: 1_000 }
    });
    expect(wrongDevice.statusCode).toBe(200);
    expect(wrongDevice.json().dispatch).toBeNull();

    const targetDevice = await app.inject({
      method: 'POST',
      url: '/api/mobile/terminal/dispatch/next',
      headers: authHeaders(),
      payload: { deviceId: deviceA, waitMs: 1_000 }
    });
    expect(targetDevice.statusCode).toBe(200);
    expect(targetDevice.json().dispatch.dispatchId).toBe(dispatchId);
  });

  it('enforces one active payment per queue and supports back-to-line sequencing', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 2 });
    const deviceId = `device_lock_${Date.now()}`;
    await registerDevice(deviceId, 'Shared iPhone');

    const firstSeat = fixture.seats[0]!.id;
    const secondSeat = fixture.seats[1]!.id;

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [firstSeat],
        ticketSelectionBySeatId: buildTicketSelection([firstSeat], fixture.tier.id),
        deviceId
      }
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [secondSeat],
        ticketSelectionBySeatId: buildTicketSelection([secondSeat], fixture.tier.id),
        deviceId
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);

    const firstDispatchId = firstResponse.json().dispatchId as string;
    const secondDispatchId = secondResponse.json().dispatchId as string;

    const startFirst = await app.inject({
      method: 'POST',
      url: `/api/mobile/payment-line/entry/${encodeURIComponent(firstDispatchId)}/start`,
      headers: authHeaders(),
      payload: { deviceId }
    });
    expect(startFirst.statusCode).toBe(200);
    expect(startFirst.json().status).toBe('PROCESSING');

    const startSecondWhileFirstActive = await app.inject({
      method: 'POST',
      url: `/api/mobile/payment-line/entry/${encodeURIComponent(secondDispatchId)}/start`,
      headers: authHeaders(),
      payload: { deviceId }
    });
    expect(startSecondWhileFirstActive.statusCode).toBe(409);

    const moveFirstBackToLine = await app.inject({
      method: 'POST',
      url: `/api/mobile/payment-line/entry/${encodeURIComponent(firstDispatchId)}/back-to-line`,
      headers: authHeaders(),
      payload: { deviceId }
    });
    expect(moveFirstBackToLine.statusCode).toBe(200);
    expect(moveFirstBackToLine.json().status).toBe('PENDING');

    const startSecondAfterBackToLine = await app.inject({
      method: 'POST',
      url: `/api/mobile/payment-line/entry/${encodeURIComponent(secondDispatchId)}/start`,
      headers: authHeaders(),
      payload: { deviceId }
    });
    expect(startSecondAfterBackToLine.statusCode).toBe(200);
    expect(startSecondAfterBackToLine.json().status).toBe('PROCESSING');
  });

  it('times out stale active entries after the active timeout window', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1 });
    const deviceId = `device_timeout_${Date.now()}`;
    await registerDevice(deviceId, 'Timeout iPhone');

    const seatId = fixture.seats[0]!.id;
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        deviceId
      }
    });
    expect(sendResponse.statusCode).toBe(201);
    const dispatchId = sendResponse.json().dispatchId as string;

    const startResponse = await app.inject({
      method: 'POST',
      url: `/api/mobile/payment-line/entry/${encodeURIComponent(dispatchId)}/start`,
      headers: authHeaders(),
      payload: { deviceId }
    });
    expect(startResponse.statusCode).toBe(200);

    await prisma.terminalPaymentDispatch.update({
      where: { id: dispatchId },
      data: { activeTimeoutAt: new Date(Date.now() - 1_000) }
    });

    const { expireTimedOutActivePaymentLineEntries } = await import('../services/payment-line-service.js');
    const timedOut = await expireTimedOutActivePaymentLineEntries(10);
    expect(timedOut.some((item) => item.entryId === dispatchId)).toBe(true);

    const failedDispatch = await prisma.terminalPaymentDispatch.findUniqueOrThrow({
      where: { id: dispatchId }
    });
    expect(failedDispatch.status).toBe('FAILED');
    expect(failedDispatch.failureReason).toContain('too long');
  });

  it('successful completion creates one paid door order with exact mapping and stripePaymentIntentId', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 2, tierPriceCents: 2700 });
    const deviceId = `device_complete_${Date.now()}`;
    await registerDevice(deviceId, 'Completion iPhone');

    const seatIds = fixture.seats.map((seat) => seat.id);
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds,
        ticketSelectionBySeatId: buildTicketSelection(seatIds, fixture.tier.id),
        customerName: 'Card Guest',
        deviceId
      }
    });

    expect(sendResponse.statusCode).toBe(201);
    const sendBody = sendResponse.json();

    const dispatch = await prisma.terminalPaymentDispatch.findUniqueOrThrow({
      where: { id: sendBody.dispatchId }
    });
    expect(dispatch.stripePaymentIntentId).toBeTruthy();

    markPaymentIntentSucceeded(dispatch.stripePaymentIntentId!);

    const completeResponse = await app.inject({
      method: 'POST',
      url: `/api/mobile/terminal/dispatch/${encodeURIComponent(dispatch.id)}/complete`,
      headers: authHeaders(),
      payload: {
        deviceId
      }
    });

    expect(completeResponse.statusCode).toBe(200);
    const completeBody = completeResponse.json();
    expect(completeBody.success).toBe(true);
    expect(completeBody.orderId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: completeBody.orderId },
      include: {
        orderSeats: true
      }
    });

    expect(order.source).toBe('DOOR');
    expect(order.inPersonPaymentMethod).toBe('STRIPE');
    expect(order.stripePaymentIntentId).toBe(dispatch.stripePaymentIntentId);
    expect(order.orderSeats).toHaveLength(seatIds.length);

    const seatMapping = new Map(order.orderSeats.map((orderSeat) => [orderSeat.seatId, orderSeat]));
    seatIds.forEach((seatId) => {
      const orderSeat = seatMapping.get(seatId);
      expect(orderSeat).toBeTruthy();
      expect(orderSeat!.ticketType).toBe('Adult');
      expect(orderSeat!.price).toBe(2700);
    });
  });

  it('supports mock completion for terminal dispatch in non-production environments', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1, tierPriceCents: 1800 });
    const deviceId = `device_mock_${Date.now()}`;
    await registerDevice(deviceId, 'Mock iPhone');

    const seatId = fixture.seats[0]!.id;
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        customerName: 'Mock Guest',
        deviceId
      }
    });

    expect(sendResponse.statusCode).toBe(201);
    const dispatchId = sendResponse.json().dispatchId as string;

    const completeResponse = await app.inject({
      method: 'POST',
      url: `/api/mobile/terminal/dispatch/${encodeURIComponent(dispatchId)}/complete`,
      headers: authHeaders(),
      payload: {
        deviceId,
        mockApproved: true
      }
    });

    expect(completeResponse.statusCode).toBe(200);
    const completeBody = completeResponse.json();
    expect(completeBody.success).toBe(true);
    expect(completeBody.mockApproved).toBe(true);
    expect(completeBody.orderId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: completeBody.orderId }
    });
    expect(order.source).toBe('DOOR');
    expect(order.inPersonPaymentMethod).toBe('STRIPE');
    expect(order.stripePaymentIntentId).toBeTruthy();

    const savedDispatch = await prisma.terminalPaymentDispatch.findUniqueOrThrow({
      where: { id: dispatchId }
    });
    expect(savedDispatch.status).toBe('SUCCEEDED');
    expect(savedDispatch.finalOrderId).toBe(order.id);
  });

  it('failed mobile attempt stays retryable and does not create order', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1 });
    const deviceId = `device_failed_${Date.now()}`;
    await registerDevice(deviceId, 'Failure iPhone');

    const seatId = fixture.seats[0]!.id;
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        deviceId
      }
    });
    const dispatchId = sendResponse.json().dispatchId as string;

    const failedResponse = await app.inject({
      method: 'POST',
      url: `/api/mobile/terminal/dispatch/${encodeURIComponent(dispatchId)}/status`,
      headers: authHeaders(),
      payload: {
        deviceId,
        status: 'FAILED',
        failureReason: 'Card declined'
      }
    });
    expect(failedResponse.statusCode).toBe(200);

    const dispatchStatusResponse = await app.inject({
      method: 'GET',
      url: `/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(dispatchId)}`,
      headers: authHeaders()
    });

    expect(dispatchStatusResponse.statusCode).toBe(200);
    expect(dispatchStatusResponse.json().status).toBe('FAILED');
    expect(dispatchStatusResponse.json().canRetry).toBe(true);

    const orderCount = await prisma.order.count({
      where: {
        performanceId: fixture.performance.id,
        source: 'DOOR'
      }
    });
    expect(orderCount).toBe(0);
  });

  it('retry generates a fresh payment intent and re-dispatches while hold is active', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1 });
    const deviceId = `device_retry_${Date.now()}`;
    await registerDevice(deviceId, 'Retry iPhone');

    const seatId = fixture.seats[0]!.id;
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        deviceId
      }
    });

    const dispatchId = sendResponse.json().dispatchId as string;
    const beforeRetry = await prisma.terminalPaymentDispatch.findUniqueOrThrow({ where: { id: dispatchId } });

    await app.inject({
      method: 'POST',
      url: `/api/mobile/terminal/dispatch/${encodeURIComponent(dispatchId)}/status`,
      headers: authHeaders(),
      payload: {
        deviceId,
        status: 'FAILED',
        failureReason: 'Reader timeout'
      }
    });

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(dispatchId)}/retry`,
      headers: authHeaders()
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().status).toBe('PENDING');
    expect(retryResponse.json().attemptCount).toBe(2);

    const afterRetry = await prisma.terminalPaymentDispatch.findUniqueOrThrow({ where: { id: dispatchId } });
    expect(afterRetry.stripePaymentIntentId).toBeTruthy();
    expect(afterRetry.stripePaymentIntentId).not.toBe(beforeRetry.stripePaymentIntentId);
  });

  it('payment-line endpoints expose failed -> retry -> canceled transitions', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1, tierPriceCents: 2400 });
    const deviceId = `device_payment_line_${Date.now()}`;
    await registerDevice(deviceId, 'Payment Line iPhone');

    const seatId = fixture.seats[0]!.id;
    const enqueueResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/payment-line/enqueue',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        customerName: 'Queue Guest',
        deviceId
      }
    });

    expect(enqueueResponse.statusCode).toBe(201);
    const entryId = enqueueResponse.json().entryId as string;
    expect(enqueueResponse.json().status).toBe('PENDING');

    const failResponse = await app.inject({
      method: 'POST',
      url: `/api/mobile/payment-line/entry/${encodeURIComponent(entryId)}/fail`,
      headers: authHeaders(),
      payload: {
        deviceId,
        failureReason: 'Reader timeout'
      }
    });
    expect(failResponse.statusCode).toBe(200);
    expect(failResponse.json().status).toBe('FAILED');
    expect(failResponse.json().canRetry).toBe(true);

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/payment-line/entry/${encodeURIComponent(entryId)}/retry-now`,
      headers: authHeaders()
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().status).toBe('PENDING');
    expect(retryResponse.json().attemptCount).toBe(2);

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/payment-line/entry/${encodeURIComponent(entryId)}/cancel`,
      headers: authHeaders()
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().status).toBe('CANCELED');
  });

  it('manual-complete is idempotent for the same successful payment intent', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1, tierPriceCents: 2600 });
    const seatId = fixture.seats[0]!.id;
    const ticketSelectionBySeatId = buildTicketSelection([seatId], fixture.tier.id);

    const intentResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/manual-intent',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId,
        customerName: 'Manual Guest'
      }
    });
    expect(intentResponse.statusCode).toBe(200);
    const paymentIntentId = intentResponse.json().paymentIntentId as string;
    markPaymentIntentSucceeded(paymentIntentId);

    const firstComplete = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/manual-complete',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId,
        customerName: 'Manual Guest',
        paymentIntentId
      }
    });
    expect(firstComplete.statusCode).toBe(201);
    const orderId = firstComplete.json().id as string;
    expect(orderId).toBeTruthy();

    const secondComplete = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/manual-complete',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId,
        customerName: 'Manual Guest',
        paymentIntentId
      }
    });
    expect(secondComplete.statusCode).toBe(200);
    expect(secondComplete.json().alreadyCompleted).toBe(true);
    expect(secondComplete.json().id).toBe(orderId);

    const orderCount = await prisma.order.count({
      where: {
        stripePaymentIntentId: paymentIntentId
      }
    });
    expect(orderCount).toBe(1);
  });

  it('applies teacher and student comp edge-case pricing caps in quotes', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 3, tierPriceCents: 3000 });
    const seatIds = fixture.seats.map((seat) => seat.id);

    await prisma.seat.update({ where: { id: seatIds[0] }, data: { price: 1000 } });
    await prisma.seat.update({ where: { id: seatIds[1] }, data: { price: 2000 } });
    await prisma.seat.update({ where: { id: seatIds[2] }, data: { price: 3000 } });

    const teacherSelection = Object.fromEntries(seatIds.map((seatId) => [seatId, 'teacher-comp']));
    const teacherQuote = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/quote',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds,
        ticketSelectionBySeatId: teacherSelection
      }
    });

    expect(teacherQuote.statusCode).toBe(200);
    expect(teacherQuote.json().expectedAmountCents).toBe(1000);
    const teacherCompCount = teacherQuote.json().seats.filter((seat: any) => seat.ticketType === 'Teacher Comp').length;
    expect(teacherCompCount).toBe(2);

    await prisma.performance.update({
      where: { id: fixture.performance.id },
      data: { familyFreeTicketEnabled: true }
    });
    await prisma.studentTicketCredit.create({
      data: {
        showId: fixture.performance.showId,
        studentName: 'Student One',
        studentEmail: 'student1',
        allocatedTickets: 5,
        usedTickets: 0,
        pendingTickets: 0,
        isActive: true
      }
    });

    const studentSelection = Object.fromEntries(seatIds.map((seatId) => [seatId, 'student-show-comp']));
    const studentQuote = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/quote',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds,
        ticketSelectionBySeatId: studentSelection,
        studentCode: 'student1'
      }
    });

    expect(studentQuote.statusCode).toBe(200);
    expect(studentQuote.json().expectedAmountCents).toBe(1000);
    const studentCompCount = studentQuote.json().seats.filter((seat: any) => seat.ticketType === 'Student Comp').length;
    expect(studentCompCount).toBe(2);
  });

  it('expired dispatch transitions to EXPIRED and releases held seats', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1 });
    const deviceId = `device_expire_${Date.now()}`;
    await registerDevice(deviceId, 'Expire iPhone');

    const seatId = fixture.seats[0]!.id;
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/terminal/send',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        deviceId
      }
    });

    const dispatchId = sendResponse.json().dispatchId as string;
    const dispatchBefore = await prisma.terminalPaymentDispatch.findUniqueOrThrow({ where: { id: dispatchId } });

    const past = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.terminalPaymentDispatch.update({
      where: { id: dispatchId },
      data: { holdExpiresAt: past }
    });
    await prisma.holdSession.update({
      where: { holdToken: dispatchBefore.holdToken },
      data: { expiresAt: past }
    });

    const statusResponse = await app.inject({
      method: 'GET',
      url: `/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(dispatchId)}`,
      headers: authHeaders()
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().status).toBe('EXPIRED');

    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatId } });
    expect(seat.status).toBe('AVAILABLE');
    expect(seat.holdSessionId).toBeNull();
  });

  it('cash in-person finalize path is unchanged', async () => {
    const fixture = await createPerformanceFixture({ seatCount: 1, tierPriceCents: 1800 });
    const seatId = fixture.seats[0]!.id;

    const finalizeResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/in-person/finalize',
      headers: authHeaders(),
      payload: {
        performanceId: fixture.performance.id,
        seatIds: [seatId],
        ticketSelectionBySeatId: buildTicketSelection([seatId], fixture.tier.id),
        paymentMethod: 'CASH',
        customerName: 'Cash Guest'
      }
    });

    expect(finalizeResponse.statusCode).toBe(201);
    expect(finalizeResponse.json().paymentMethod).toBe('CASH');

    const paidOrder = await prisma.order.findFirstOrThrow({
      where: {
        performanceId: fixture.performance.id,
        source: 'DOOR',
        inPersonPaymentMethod: 'CASH'
      }
    });

    expect(paidOrder.status).toBe('PAID');
    expect(paidOrder.amountTotal).toBe(1800);
  });
});
