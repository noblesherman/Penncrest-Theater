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

const schemaName = `senior_sendoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_senior_sendoff';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_senior_sendoff';
process.env.JWT_SECRET = 'senior-sendoff-test-secret-12345';
process.env.ADMIN_USERNAME = 'senior-sendoff-admin';
process.env.ADMIN_PASSWORD = 'senior-sendoff-admin-password';
process.env.STAFF_ALLOWED_DOMAIN = 'rtmsd.org';

const stripeState = {
  counter: 0,
  intents: new Map<
    string,
    {
      id: string;
      client_secret: string;
      status: string;
      amount: number;
      currency: string;
      metadata: Record<string, string>;
      receipt_email: string | null;
    }
  >()
};

vi.mock('../lib/stripe.js', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(async (params: any) => {
        stripeState.counter += 1;
        const id = `pi_sendoff_${stripeState.counter}`;
        const paymentIntent = {
          id,
          client_secret: `${id}_secret`,
          status: 'succeeded',
          amount: params.amount || 0,
          currency: (params.currency || 'usd').toLowerCase(),
          metadata: params.metadata || {},
          receipt_email: params.receipt_email || null
        };
        stripeState.intents.set(id, paymentIntent);
        return paymentIntent;
      }),
      retrieve: vi.fn(async (paymentIntentId: string) => {
        const intent = stripeState.intents.get(paymentIntentId);
        if (!intent) {
          throw new Error(`Unknown payment intent ${paymentIntentId}`);
        }
        return intent;
      })
    }
  }
}));

vi.mock('../lib/email.js', () => ({
  sendTicketsEmail: vi.fn(async () => undefined),
  sendDonationThankYouEmail: vi.fn(async () => undefined),
  sendSeniorSendoffSubmissionEmail: vi.fn(async () => undefined)
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

async function createShowWithPerformance(title: string) {
  const show = await prisma.show.create({
    data: {
      title,
      description: 'Senior send-off test show'
    }
  });

  await prisma.performance.create({
    data: {
      showId: show.id,
      title: `${title} Performance`,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      salesCutoffAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
      venue: 'Senior Sendoff Test Theater'
    }
  });

  return show;
}

describe.sequential('senior send-off forms integration', () => {
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
        username: 'senior-sendoff-admin',
        name: 'Senior Sendoff Admin',
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
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('allows first free, requires payment for second, and blocks third submission', async () => {
    const show = await createShowWithPerformance(`Senior Sendoff Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms/senior-sendoff',
      headers: authHeaders(),
      payload: { showId: show.id, secondSubmissionPriceCents: 2000 }
    });
    expect(createResponse.statusCode).toBe(201);
    const form = createResponse.json();

    const firstSubmit = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        parentName: 'Jordan Parent',
        parentEmail: 'jordan.parent@example.com',
        parentPhone: '610-555-0100',
        studentName: 'Taylor Senior',
        message: 'We are so proud of you!'
      }
    });
    expect(firstSubmit.statusCode).toBe(201);
    expect(firstSubmit.json().isPaid).toBe(false);

    const secondWithoutPayment = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        parentName: 'Jordan Parent',
        parentEmail: 'jordan.parent@example.com',
        parentPhone: '610-555-0100',
        studentName: 'Taylor Senior',
        message: 'One more message!'
      }
    });
    expect(secondWithoutPayment.statusCode).toBe(402);
    expect(secondWithoutPayment.json().requiresPayment).toBe(true);

    const paymentIntent = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/payment-intent`,
      payload: {
        parentName: 'Jordan Parent',
        parentEmail: 'jordan.parent@example.com',
        studentName: 'Taylor Senior'
      }
    });
    expect(paymentIntent.statusCode).toBe(200);
    const paymentIntentBody = paymentIntent.json();
    expect(paymentIntentBody.paymentIntentId).toContain('pi_sendoff_');

    const secondPaidSubmit = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        parentName: 'Jordan Parent',
        parentEmail: 'jordan.parent@example.com',
        parentPhone: '610-555-0100',
        studentName: 'Taylor Senior',
        message: 'One more message!',
        paymentIntentId: paymentIntentBody.paymentIntentId
      }
    });
    expect(secondPaidSubmit.statusCode).toBe(201);
    expect(secondPaidSubmit.json().isPaid).toBe(true);

    const thirdSubmit = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        parentName: 'Jordan Parent',
        parentEmail: 'jordan.parent@example.com',
        parentPhone: '610-555-0100',
        studentName: 'Taylor Senior',
        message: 'Third should fail'
      }
    });
    expect(thirdSubmit.statusCode).toBe(409);
    expect(thirdSubmit.json().error).toContain('maximum of 2');

    const rows = await prisma.seniorSendoffSubmission.findMany({
      where: {
        formId: form.id,
        parentEmail: 'jordan.parent@example.com'
      },
      orderBy: {
        entryNumber: 'asc'
      }
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].entryNumber).toBe(1);
    expect(rows[0].isPaid).toBe(false);
    expect(rows[1].entryNumber).toBe(2);
    expect(rows[1].isPaid).toBe(true);
  });

  it('supports custom questions and validates required responses', async () => {
    const show = await createShowWithPerformance(`Senior Sendoff Questions ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms/senior-sendoff',
      headers: authHeaders(),
      payload: { showId: show.id, secondSubmissionPriceCents: 0 }
    });
    expect(createResponse.statusCode).toBe(201);
    const form = createResponse.json();

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/forms/senior-sendoff/${encodeURIComponent(form.id)}`,
      headers: authHeaders(),
      payload: {
        questions: {
          messageLabel: 'Playbill Message',
          customQuestions: [
            {
              id: 'relationship',
              label: 'Relationship',
              type: 'multiple_choice',
              required: true,
              options: ['Parent', 'Sibling', 'Guardian']
            },
            {
              id: 'favorite-memory',
              label: 'Favorite Memory',
              type: 'long_text',
              required: false
            }
          ]
        }
      }
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().questions.messageLabel).toBe('Playbill Message');
    expect(patchResponse.json().questions.customQuestions).toHaveLength(2);

    const missingRequiredCustom = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        parentName: 'Sam Parent',
        parentEmail: 'sam.parent@example.com',
        parentPhone: '610-555-0199',
        studentName: 'Avery Senior',
        message: 'Proud of you!'
      }
    });
    expect(missingRequiredCustom.statusCode).toBe(400);
    expect(missingRequiredCustom.json().error).toContain('Relationship is required');

    const validSubmit = await app.inject({
      method: 'POST',
      url: `/api/forms/senior-sendoff/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        parentName: 'Sam Parent',
        parentEmail: 'sam.parent@example.com',
        parentPhone: '610-555-0199',
        studentName: 'Avery Senior',
        message: 'Proud of you!',
        customResponses: {
          relationship: 'Parent',
          'favorite-memory': 'Opening night rehearsals were unforgettable.'
        }
      }
    });
    expect(validSubmit.statusCode).toBe(201);

    const stored = await prisma.seniorSendoffSubmission.findFirstOrThrow({
      where: {
        formId: form.id,
        parentEmail: 'sam.parent@example.com'
      }
    });
    const storedResponses = (stored.extraResponses || {}) as Record<string, string>;
    expect(storedResponses.relationship).toBe('Parent');
    expect(storedResponses['favorite-memory']).toContain('Opening night');
  });
});
