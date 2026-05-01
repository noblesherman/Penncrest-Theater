/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/orders.integration.test.ts`
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

const schemaName = `orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend integration tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_orders';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_orders';
process.env.JWT_SECRET = 'orders-integration-secret-12345';
process.env.ADMIN_USERNAME = 'orders-admin';
process.env.ADMIN_PASSWORD = 'orders-admin-password';
process.env.ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER = 'false';
process.env.ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER = 'false';
process.env.ENABLE_IN_PROCESS_HEALTH_ALERT_MONITOR = 'false';
process.env.ENABLE_IN_PROCESS_PAYMENT_LINE_WORKER = 'false';
process.env.ENABLE_IN_PROCESS_TICKET_EMAIL_OUTBOX_WORKER = 'false';

vi.mock('../lib/email.js', () => ({
  sendTicketsEmail: vi.fn(async () => undefined)
}));

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;

async function seedPaidOrderWithTwoTickets(params?: {
  email?: string;
  checkedInBy?: string;
  checkedInAt?: Date;
}) {
  const show = await prisma.show.create({
    data: {
      title: 'Orders Integration Show',
      description: 'Orders integration test show'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      title: 'Orders Integration Performance',
      startsAt: new Date('2026-05-10T23:00:00.000Z'),
      salesCutoffAt: new Date('2026-05-10T22:00:00.000Z'),
      venue: 'Penncrest Theater'
    }
  });

  const seatA = await prisma.seat.create({
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
  const seatB = await prisma.seat.create({
    data: {
      performanceId: performance.id,
      row: 'A',
      number: 2,
      sectionName: 'Orchestra',
      x: 20,
      y: 10,
      price: 2500
    }
  });

  const order = await prisma.order.create({
    data: {
      performanceId: performance.id,
      email: (params?.email || `buyer_${Date.now()}@example.com`).toLowerCase(),
      customerName: 'Orders Integration Buyer',
      customerPhone: '610-555-0123',
      amountTotal: 5000,
      currency: 'usd',
      status: 'PAID',
      source: 'ONLINE',
      accessToken: `tok_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
    }
  });

  await prisma.orderSeat.create({
    data: {
      orderId: order.id,
      seatId: seatA.id,
      price: 2500,
      ticketType: 'Adult'
    }
  });
  await prisma.orderSeat.create({
    data: {
      orderId: order.id,
      seatId: seatB.id,
      price: 2500,
      ticketType: 'Adult'
    }
  });

  const checkedInAt = params?.checkedInAt || new Date('2026-04-20T18:30:00.000Z');
  const checkedInBy = params?.checkedInBy || 'MAIN_GATE';

  await prisma.ticket.create({
    data: {
      id: `ticket_${Math.random().toString(36).slice(2)}`,
      orderId: order.id,
      performanceId: performance.id,
      seatId: seatA.id,
      type: 'PAID',
      priceCents: 2500,
      status: 'ISSUED',
      publicId: `pub_${Math.random().toString(36).slice(2, 10)}`,
      qrSecret: `sec_${Math.random().toString(36).slice(2)}`,
      qrPayload: 'pt://ticket/integration/1',
      checkedInAt,
      checkedInBy
    }
  });
  await prisma.ticket.create({
    data: {
      id: `ticket_${Math.random().toString(36).slice(2)}`,
      orderId: order.id,
      performanceId: performance.id,
      seatId: seatB.id,
      type: 'PAID',
      priceCents: 2500,
      status: 'ISSUED',
      publicId: `pub_${Math.random().toString(36).slice(2, 10)}`,
      qrSecret: `sec_${Math.random().toString(36).slice(2)}`,
      qrPayload: 'pt://ticket/integration/2',
      checkedInAt: null,
      checkedInBy: null
    }
  });

  return { order, performance, seatA, seatB, checkedInAt, checkedInBy };
}

describe.sequential('orders routes integration', () => {
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
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('GET /api/orders/:id returns per-ticket check-in metadata', async () => {
    const seeded = await seedPaidOrderWithTwoTickets();

    const response = await app.inject({
      method: 'GET',
      url: `/api/orders/${seeded.order.id}?token=${encodeURIComponent(seeded.order.accessToken)}`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.tickets).toHaveLength(2);
    const checkedInTicket = body.tickets.find((ticket: any) => ticket.seatId === seeded.seatA.id);
    const notCheckedInTicket = body.tickets.find((ticket: any) => ticket.seatId === seeded.seatB.id);

    expect(checkedInTicket).toBeTruthy();
    expect(checkedInTicket.checkedInAt).toBe(seeded.checkedInAt.toISOString());
    expect(checkedInTicket.checkedInBy).toBe(seeded.checkedInBy);

    expect(notCheckedInTicket).toBeTruthy();
    expect(notCheckedInTicket.checkedInAt).toBeNull();
    expect(notCheckedInTicket.checkedInBy).toBeNull();
  });

  it('POST /api/orders/lookup returns orderAccessToken only for valid orderId + email', async () => {
    const email = `lookup_${Date.now()}@example.com`;
    const seeded = await seedPaidOrderWithTwoTickets({ email });

    const validLookupResponse = await app.inject({
      method: 'POST',
      url: '/api/orders/lookup',
      payload: {
        orderId: seeded.order.id,
        email
      }
    });

    expect(validLookupResponse.statusCode).toBe(200);
    const validBody = validLookupResponse.json();
    expect(validBody.order.id).toBe(seeded.order.id);
    expect(validBody.orderAccessToken).toBe(seeded.order.accessToken);

    const invalidLookupResponse = await app.inject({
      method: 'POST',
      url: '/api/orders/lookup',
      payload: {
        orderId: seeded.order.id,
        email: `wrong_${email}`
      }
    });

    expect(invalidLookupResponse.statusCode).toBe(404);
  });

  it('refuses to issue a second ticket when an issued ticket already exists for the seat', async () => {
    const seeded = await seedPaidOrderWithTwoTickets({
      email: `existing_${Date.now()}@example.com`
    });
    const { createAssignedOrder } = await import('../services/order-assignment.js');

    await expect(
      createAssignedOrder({
        performanceId: seeded.performance.id,
        seatIds: [seeded.seatA.id],
        customerName: 'Duplicate Seat Buyer',
        customerEmail: `duplicate_${Date.now()}@example.com`,
        source: 'STAFF_COMP',
        ticketTypeBySeatId: { [seeded.seatA.id]: 'Teacher Comp' },
        priceBySeatId: { [seeded.seatA.id]: 0 },
        allowHeldSeats: false,
        enforceSalesCutoff: false,
        sendEmail: false
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('already has an issued ticket')
    });
  });
});
