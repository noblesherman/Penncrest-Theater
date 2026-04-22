/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/admin-dashboard.integration.test.ts`
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

type StripeMockIntent = {
  id: string;
  amount: number;
  status: string;
  created: number;
  metadata?: Record<string, string>;
};

const stripeState: {
  failList: boolean;
  intents: StripeMockIntent[];
} = {
  failList: false,
  intents: []
};

vi.mock('../lib/stripe.js', () => ({
  stripe: {
    paymentIntents: {
      list: vi.fn(async (params?: { limit?: number; created?: { gte?: number; lte?: number }; starting_after?: string }) => {
        if (stripeState.failList) {
          throw new Error('Stripe unavailable in test');
        }

        const limit = Math.min(Math.max(params?.limit || 10, 1), 100);
        const gte = typeof params?.created?.gte === 'number' ? params.created.gte : Number.NEGATIVE_INFINITY;
        const lte = typeof params?.created?.lte === 'number' ? params.created.lte : Number.POSITIVE_INFINITY;

        let filtered = stripeState.intents
          .filter((intent) => intent.created >= gte && intent.created <= lte)
          .sort((a, b) => b.created - a.created);

        if (params?.starting_after) {
          const startingIndex = filtered.findIndex((intent) => intent.id === params.starting_after);
          if (startingIndex >= 0) {
            filtered = filtered.slice(startingIndex + 1);
          }
        }

        const data = filtered.slice(0, limit).map((intent) => ({ ...intent }));

        return {
          data,
          has_more: filtered.length > limit
        };
      })
    }
  }
}));

const schemaName = `admin_dashboard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_dashboard';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dashboard';
process.env.JWT_SECRET = 'dashboard-test-secret-12345';
process.env.ADMIN_USERNAME = 'dashboard-admin';
process.env.ADMIN_PASSWORD = 'dashboard-admin-password';

type DashboardRange = 'month' | 'today' | 'rolling30';

type DashboardPayload = {
  generatedAt: string;
  range: DashboardRange;
  core: {
    paidRevenueCents: number;
    paidOrderCount: number;
    ticketsIssuedCount: number;
    checkInsCount: number;
  };
  operations: {
    upcomingPerformances: Array<{
      id: string;
      title: string;
      startsAt: string;
      venue: string;
    }>;
    recentOrders: Array<{
      id: string;
      performance: {
        id: string;
        title: string;
        startsAt: string;
      };
      status: string;
      amountTotalCents: number;
      createdAt: string;
    }>;
    scanner: {
      activeSessions: number;
      latestScanAt: string | null;
    };
  };
  quickLinks: {
    orders: string;
    scanner: string;
    drive?: string;
    trips?: string;
    fundraise?: string;
    forms?: string;
    audit?: string;
  };
  adminModules?: {
    trips: {
      activeTripCount: number;
      enrollmentCount: number;
      collectedCents: number;
      remainingCents: number;
      nextDueAt: string | null;
    };
    fundraise: {
      activeEventCount: number;
      seatsSold: number;
      seatsTotal: number;
      donationSucceededCents: number | null;
    };
    forms: {
      openCount: number;
      closedCount: number;
      responseCount: number;
      programBio: {
        openCount: number;
        closedCount: number;
        responseCount: number;
      };
      seniorSendoff: {
        openCount: number;
        closedCount: number;
        responseCount: number;
      };
    };
    system: {
      recentAudit: Array<{
        id: string;
      }>;
    };
  };
};

type CoreSeed = {
  createdAt: Date;
  amountCents: number;
  checkedInAt: Date | null;
};

type SeededExpectations = {
  coreRows: CoreSeed[];
  donationIntents: StripeMockIntent[];
  trips: {
    activeTripCount: number;
    enrollmentCount: number;
    collectedCents: number;
    remainingCents: number;
    nextDueAtIso: string;
  };
  forms: {
    openCount: number;
    closedCount: number;
    responseCount: number;
    programBio: {
      openCount: number;
      closedCount: number;
      responseCount: number;
    };
    seniorSendoff: {
      openCount: number;
      closedCount: number;
      responseCount: number;
    };
  };
  fundraise: {
    activeEventCount: number;
    seatsSold: number;
    seatsTotal: number;
  };
};

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;
let adminToken: string;
let boxOfficeToken: string;
let seeded: SeededExpectations;
let idCounter = 0;

function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`
  };
}

function getRangeStart(range: DashboardRange, now: Date): Date {
  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (range === 'rolling30') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function inRange(value: Date, range: DashboardRange, now: Date): boolean {
  const start = getRangeStart(range, now);
  return value >= start && value <= now;
}

function expectedCoreForRange(range: DashboardRange, now: Date) {
  const rows = seeded.coreRows.filter((row) => inRange(row.createdAt, range, now));
  const paidRevenueCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const paidOrderCount = rows.length;
  const ticketsIssuedCount = rows.length;
  const checkInsCount = rows.filter((row) => row.checkedInAt && inRange(row.checkedInAt, range, now)).length;

  return {
    paidRevenueCents,
    paidOrderCount,
    ticketsIssuedCount,
    checkInsCount
  };
}

function expectedDonationForRange(range: DashboardRange, now: Date): number {
  const start = getRangeStart(range, now);
  const startEpoch = Math.floor(start.getTime() / 1000);
  const nowEpoch = Math.floor(now.getTime() / 1000);

  return seeded.donationIntents
    .filter((intent) => intent.metadata?.source === 'fundraising_donation')
    .filter((intent) => intent.status === 'succeeded')
    .filter((intent) => intent.created >= startEpoch && intent.created <= nowEpoch)
    .reduce((sum, intent) => sum + intent.amount, 0);
}

async function createPerformance(params: {
  showTitle: string;
  performanceTitle: string;
  startsAt: Date;
  isArchived?: boolean;
  isFundraiser?: boolean;
}): Promise<{ id: string }> {
  const show = await prisma.show.create({
    data: {
      title: params.showTitle,
      description: 'Dashboard integration test show'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      title: params.performanceTitle,
      startsAt: params.startsAt,
      salesCutoffAt: new Date(params.startsAt.getTime() - 60 * 60 * 1000),
      venue: 'Test Theater',
      isArchived: Boolean(params.isArchived),
      isFundraiser: Boolean(params.isFundraiser)
    }
  });

  return { id: performance.id };
}

async function createOrderWithTicket(params: {
  performanceId: string;
  createdAt: Date;
  amountCents: number;
  status: 'PAID' | 'PENDING' | 'CANCELED';
  checkedInAt?: Date | null;
}): Promise<void> {
  const order = await prisma.order.create({
    data: {
      performanceId: params.performanceId,
      email: `${uid('buyer')}@example.com`,
      customerName: uid('Customer'),
      amountTotal: params.amountCents,
      status: params.status,
      accessToken: uid('access'),
      createdAt: params.createdAt
    }
  });

  if (params.status !== 'PAID') {
    return;
  }

  await prisma.ticket.create({
    data: {
      id: uid('ticket'),
      orderId: order.id,
      performanceId: params.performanceId,
      publicId: uid('public'),
      qrSecret: uid('secret'),
      qrPayload: uid('payload'),
      createdAt: params.createdAt,
      checkedInAt: params.checkedInAt ?? null,
      checkInGate: params.checkedInAt ? 'Main' : null
    }
  });
}

async function seedDashboardData(): Promise<SeededExpectations> {
  const now = new Date();

  const corePerformance = await createPerformance({
    showTitle: 'Core Show',
    performanceTitle: 'Core Performance',
    startsAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  });

  const archivedPerformance = await createPerformance({
    showTitle: 'Archived Show',
    performanceTitle: 'Archived Performance',
    startsAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    isArchived: true
  });

  const coreRows: CoreSeed[] = [
    {
      createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      amountCents: 1100,
      checkedInAt: new Date(now.getTime() - 20 * 60 * 1000)
    },
    {
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      amountCents: 2200,
      checkedInAt: null
    },
    {
      createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      amountCents: 3300,
      checkedInAt: new Date(now.getTime() - 19 * 24 * 60 * 60 * 1000)
    },
    {
      createdAt: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000),
      amountCents: 4400,
      checkedInAt: new Date(now.getTime() - 44 * 24 * 60 * 60 * 1000)
    }
  ];

  for (const row of coreRows) {
    await createOrderWithTicket({
      performanceId: corePerformance.id,
      createdAt: row.createdAt,
      amountCents: row.amountCents,
      status: 'PAID',
      checkedInAt: row.checkedInAt
    });
  }

  await createOrderWithTicket({
    performanceId: archivedPerformance.id,
    createdAt: new Date(now.getTime() - 15 * 60 * 1000),
    amountCents: 9999,
    status: 'PAID',
    checkedInAt: new Date(now.getTime() - 12 * 60 * 1000)
  });

  for (let index = 0; index < 6; index += 1) {
    await createOrderWithTicket({
      performanceId: corePerformance.id,
      createdAt: new Date(now.getTime() - (index + 1) * 3 * 60 * 1000),
      amountCents: 0,
      status: index % 2 === 0 ? 'PENDING' : 'CANCELED'
    });
  }

  for (let index = 0; index < 6; index += 1) {
    await createPerformance({
      showTitle: `Upcoming ${index + 1}`,
      performanceTitle: `Upcoming Performance ${index + 1}`,
      startsAt: new Date(now.getTime() + (index + 2) * 24 * 60 * 60 * 1000)
    });
  }

  await createPerformance({
    showTitle: 'Archived Upcoming',
    performanceTitle: 'Archived Upcoming Performance',
    startsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    isArchived: true
  });

  const scannerPerformance = await createPerformance({
    showTitle: 'Scanner Show',
    performanceTitle: 'Scanner Performance',
    startsAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
  });

  const archivedScannerPerformance = await createPerformance({
    showTitle: 'Archived Scanner Show',
    performanceTitle: 'Archived Scanner Performance',
    startsAt: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
    isArchived: true
  });

  const activeSession = await prisma.scannerSession.create({
    data: {
      performanceId: scannerPerformance.id,
      accessToken: uid('scanner_token'),
      staffName: 'Door A',
      gate: 'Main',
      active: true,
      createdBy: 'dashboard-test'
    }
  });

  await prisma.scannerSession.create({
    data: {
      performanceId: scannerPerformance.id,
      accessToken: uid('scanner_token'),
      staffName: 'Door B',
      gate: 'Side',
      active: false,
      endedAt: new Date(now.getTime() - 60 * 1000),
      createdBy: 'dashboard-test'
    }
  });

  await prisma.scannerSession.create({
    data: {
      performanceId: archivedScannerPerformance.id,
      accessToken: uid('scanner_token'),
      staffName: 'Archived Door',
      gate: 'Back',
      active: true,
      createdBy: 'dashboard-test'
    }
  });

  await prisma.checkInScanAttempt.create({
    data: {
      performanceId: scannerPerformance.id,
      scannerSessionId: activeSession.id,
      action: 'SCAN_INVALID_QR',
      actor: 'Door A',
      gate: 'Main',
      createdAt: new Date(now.getTime() - 8 * 60 * 1000)
    }
  });

  await prisma.checkInScanAttempt.create({
    data: {
      performanceId: scannerPerformance.id,
      scannerSessionId: activeSession.id,
      action: 'SCAN_NOT_FOUND',
      actor: 'Door A',
      gate: 'Main',
      createdAt: new Date(now.getTime() - 2 * 60 * 1000)
    }
  });

  await prisma.checkInScanAttempt.create({
    data: {
      performanceId: archivedScannerPerformance.id,
      action: 'SCAN_INVALID_QR',
      actor: 'Archived Door',
      gate: 'Back',
      createdAt: new Date(now.getTime() - 60 * 1000)
    }
  });

  const tripOne = await prisma.trip.create({
    data: {
      title: 'Trip One',
      slug: uid('trip-one'),
      dueAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      defaultCostCents: 10000
    }
  });

  const tripTwo = await prisma.trip.create({
    data: {
      title: 'Trip Two',
      slug: uid('trip-two'),
      dueAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      defaultCostCents: 8000
    }
  });

  const archivedTrip = await prisma.trip.create({
    data: {
      title: 'Archived Trip',
      slug: uid('trip-archived'),
      dueAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      defaultCostCents: 5000,
      isArchived: true
    }
  });

  const studentA = await prisma.tripStudent.create({ data: { name: 'Student A', grade: '10' } });
  const studentB = await prisma.tripStudent.create({ data: { name: 'Student B', grade: '11' } });
  const studentC = await prisma.tripStudent.create({ data: { name: 'Student C', grade: '12' } });
  const studentD = await prisma.tripStudent.create({ data: { name: 'Student D', grade: '9' } });

  const accountA = await prisma.tripAccount.create({ data: { email: `${uid('trip-a')}@example.com`, studentId: studentA.id } });
  const accountB = await prisma.tripAccount.create({ data: { email: `${uid('trip-b')}@example.com`, studentId: studentB.id } });
  const accountC = await prisma.tripAccount.create({ data: { email: `${uid('trip-c')}@example.com`, studentId: studentC.id } });
  const accountD = await prisma.tripAccount.create({ data: { email: `${uid('trip-d')}@example.com`, studentId: studentD.id } });

  const enrollmentOne = await prisma.tripEnrollment.create({
    data: {
      tripId: tripOne.id,
      studentId: studentA.id,
      targetAmountCents: 10000
    }
  });

  const enrollmentTwoDueAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const enrollmentTwo = await prisma.tripEnrollment.create({
    data: {
      tripId: tripOne.id,
      studentId: studentB.id,
      targetAmountCents: 12000,
      dueAtOverride: enrollmentTwoDueAt
    }
  });

  const enrollmentThree = await prisma.tripEnrollment.create({
    data: {
      tripId: tripTwo.id,
      studentId: studentC.id,
      targetAmountCents: 8000
    }
  });

  const archivedEnrollment = await prisma.tripEnrollment.create({
    data: {
      tripId: archivedTrip.id,
      studentId: studentD.id,
      targetAmountCents: 5000
    }
  });

  await prisma.tripPayment.create({
    data: {
      enrollmentId: enrollmentOne.id,
      accountId: accountA.id,
      amountCents: 4000,
      status: 'SUCCEEDED',
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000)
    }
  });

  await prisma.tripPayment.create({
    data: {
      enrollmentId: enrollmentTwo.id,
      accountId: accountB.id,
      amountCents: 12000,
      status: 'SUCCEEDED',
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000)
    }
  });

  await prisma.tripPayment.create({
    data: {
      enrollmentId: enrollmentThree.id,
      accountId: accountC.id,
      amountCents: 2000,
      status: 'PENDING'
    }
  });

  await prisma.tripPayment.create({
    data: {
      enrollmentId: archivedEnrollment.id,
      accountId: accountD.id,
      amountCents: 5000,
      status: 'SUCCEEDED',
      paidAt: new Date(now.getTime() - 24 * 60 * 60 * 1000)
    }
  });

  const showProgramOpen = await prisma.show.create({ data: { title: 'Program Open Show' } });
  const showProgramClosedDeadline = await prisma.show.create({ data: { title: 'Program Closed Deadline Show' } });
  const showProgramClosedManual = await prisma.show.create({ data: { title: 'Program Closed Manual Show' } });

  const programOpen = await prisma.programBioForm.create({
    data: {
      showId: showProgramOpen.id,
      publicSlug: uid('program-open'),
      title: 'Program Open',
      instructions: 'Program open instructions',
      deadlineAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      isOpen: true
    }
  });

  const programClosedByDeadline = await prisma.programBioForm.create({
    data: {
      showId: showProgramClosedDeadline.id,
      publicSlug: uid('program-closed-deadline'),
      title: 'Program Closed Deadline',
      instructions: 'Program closed instructions',
      deadlineAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      isOpen: true
    }
  });

  const programClosedManual = await prisma.programBioForm.create({
    data: {
      showId: showProgramClosedManual.id,
      publicSlug: uid('program-closed-manual'),
      title: 'Program Closed Manual',
      instructions: 'Program closed manual instructions',
      deadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      isOpen: false
    }
  });

  await prisma.programBioSubmission.create({
    data: {
      formId: programOpen.id,
      fullName: 'Program Student One',
      schoolEmail: `${uid('program1')}@rtmsd.org`,
      gradeLevel: 10,
      roleInShow: 'Lead',
      bio: 'Program bio one',
      headshotUrl: 'https://cdn.test/program1.jpg'
    }
  });

  await prisma.programBioSubmission.create({
    data: {
      formId: programOpen.id,
      fullName: 'Program Student Two',
      schoolEmail: `${uid('program2')}@rtmsd.org`,
      gradeLevel: 11,
      roleInShow: 'Crew',
      bio: 'Program bio two',
      headshotUrl: 'https://cdn.test/program2.jpg'
    }
  });

  await prisma.programBioSubmission.create({
    data: {
      formId: programClosedManual.id,
      fullName: 'Program Student Three',
      schoolEmail: `${uid('program3')}@rtmsd.org`,
      gradeLevel: 12,
      roleInShow: 'Ensemble',
      bio: 'Program bio three',
      headshotUrl: 'https://cdn.test/program3.jpg'
    }
  });

  const showSeniorOpen = await prisma.show.create({ data: { title: 'Senior Open Show' } });
  const showSeniorClosed = await prisma.show.create({ data: { title: 'Senior Closed Show' } });

  const seniorOpen = await prisma.seniorSendoffForm.create({
    data: {
      showId: showSeniorOpen.id,
      publicSlug: uid('senior-open'),
      title: 'Senior Open',
      instructions: 'Senior open instructions',
      deadlineAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      isOpen: true
    }
  });

  const seniorClosed = await prisma.seniorSendoffForm.create({
    data: {
      showId: showSeniorClosed.id,
      publicSlug: uid('senior-closed'),
      title: 'Senior Closed',
      instructions: 'Senior closed instructions',
      deadlineAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      isOpen: false
    }
  });

  await prisma.seniorSendoffSubmission.create({
    data: {
      formId: seniorOpen.id,
      parentName: 'Parent One',
      parentEmail: `${uid('parent1')}@example.com`,
      parentPhone: '610-555-0001',
      studentName: 'Senior One',
      studentKey: 'senior one',
      message: 'Congrats one',
      entryNumber: 1,
      isPaid: false
    }
  });

  await prisma.seniorSendoffSubmission.create({
    data: {
      formId: seniorClosed.id,
      parentName: 'Parent Two',
      parentEmail: `${uid('parent2')}@example.com`,
      parentPhone: '610-555-0002',
      studentName: 'Senior Two',
      studentKey: 'senior two',
      message: 'Congrats two',
      entryNumber: 1,
      isPaid: false
    }
  });

  await prisma.seniorSendoffSubmission.create({
    data: {
      formId: seniorClosed.id,
      parentName: 'Parent Three',
      parentEmail: `${uid('parent3')}@example.com`,
      parentPhone: '610-555-0003',
      studentName: 'Senior Three',
      studentKey: 'senior three',
      message: 'Congrats three',
      entryNumber: 1,
      isPaid: true,
      paymentIntentId: uid('pi_paid')
    }
  });

  const fundraiserOne = await createPerformance({
    showTitle: 'Fundraiser One',
    performanceTitle: 'Fundraiser One Performance',
    startsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    isFundraiser: true
  });

  const fundraiserTwo = await createPerformance({
    showTitle: 'Fundraiser Two',
    performanceTitle: 'Fundraiser Two Performance',
    startsAt: new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000),
    isFundraiser: true
  });

  const fundraiserArchived = await createPerformance({
    showTitle: 'Fundraiser Archived',
    performanceTitle: 'Fundraiser Archived Performance',
    startsAt: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
    isFundraiser: true,
    isArchived: true
  });

  const fundraiserPast = await createPerformance({
    showTitle: 'Fundraiser Past',
    performanceTitle: 'Fundraiser Past Performance',
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    isFundraiser: true
  });

  await prisma.seat.createMany({
    data: [
      {
        performanceId: fundraiserOne.id,
        row: 'A',
        number: 1,
        sectionName: 'Orch',
        x: 1,
        y: 1,
        price: 2000,
        status: 'SOLD'
      },
      {
        performanceId: fundraiserOne.id,
        row: 'A',
        number: 2,
        sectionName: 'Orch',
        x: 2,
        y: 1,
        price: 2000,
        status: 'SOLD'
      },
      {
        performanceId: fundraiserOne.id,
        row: 'A',
        number: 3,
        sectionName: 'Orch',
        x: 3,
        y: 1,
        price: 2000,
        status: 'AVAILABLE'
      },
      {
        performanceId: fundraiserTwo.id,
        row: 'B',
        number: 1,
        sectionName: 'Orch',
        x: 1,
        y: 2,
        price: 2500,
        status: 'SOLD'
      },
      {
        performanceId: fundraiserTwo.id,
        row: 'B',
        number: 2,
        sectionName: 'Orch',
        x: 2,
        y: 2,
        price: 2500,
        status: 'AVAILABLE'
      },
      {
        performanceId: fundraiserArchived.id,
        row: 'C',
        number: 1,
        sectionName: 'Balcony',
        x: 1,
        y: 3,
        price: 1500,
        status: 'SOLD'
      },
      {
        performanceId: fundraiserArchived.id,
        row: 'C',
        number: 2,
        sectionName: 'Balcony',
        x: 2,
        y: 3,
        price: 1500,
        status: 'SOLD'
      },
      {
        performanceId: fundraiserPast.id,
        row: 'D',
        number: 1,
        sectionName: 'Balcony',
        x: 1,
        y: 4,
        price: 1800,
        status: 'SOLD'
      }
    ]
  });

  for (let index = 0; index < 8; index += 1) {
    await prisma.auditLog.create({
      data: {
        actor: `actor_${index}`,
        action: `ACTION_${index}`,
        entityType: 'TEST',
        entityId: `entity_${index}`,
        createdAt: new Date(now.getTime() - index * 60 * 1000)
      }
    });
  }

  const nowEpoch = Math.floor(now.getTime() / 1000);
  const donationIntents: StripeMockIntent[] = [
    {
      id: uid('pi_donation_success_today'),
      amount: 5100,
      status: 'succeeded',
      created: nowEpoch - 60 * 60,
      metadata: {
        source: 'fundraising_donation'
      }
    },
    {
      id: uid('pi_donation_pending_today'),
      amount: 3200,
      status: 'requires_payment_method',
      created: nowEpoch - 45 * 60,
      metadata: {
        source: 'fundraising_donation'
      }
    },
    {
      id: uid('pi_donation_success_rolling'),
      amount: 700,
      status: 'succeeded',
      created: nowEpoch - 10 * 24 * 60 * 60,
      metadata: {
        source: 'fundraising_donation'
      }
    },
    {
      id: uid('pi_donation_success_old'),
      amount: 2200,
      status: 'succeeded',
      created: nowEpoch - 40 * 24 * 60 * 60,
      metadata: {
        source: 'fundraising_donation'
      }
    },
    {
      id: uid('pi_non_donation'),
      amount: 999,
      status: 'succeeded',
      created: nowEpoch - 30 * 60,
      metadata: {
        source: 'other_source'
      }
    }
  ];

  stripeState.intents = donationIntents;

  return {
    coreRows,
    donationIntents,
    trips: {
      activeTripCount: 2,
      enrollmentCount: 3,
      collectedCents: 16000,
      remainingCents: 14000,
      nextDueAtIso: enrollmentTwoDueAt.toISOString()
    },
    forms: {
      openCount: 2,
      closedCount: 3,
      responseCount: 6,
      programBio: {
        openCount: 1,
        closedCount: 2,
        responseCount: 3
      },
      seniorSendoff: {
        openCount: 1,
        closedCount: 1,
        responseCount: 3
      }
    },
    fundraise: {
      activeEventCount: 2,
      seatsSold: 3,
      seatsTotal: 5
    }
  };
}

describe.sequential('admin dashboard integration', () => {
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
        username: 'dashboard-admin',
        name: 'Dashboard Admin',
        passwordHash: 'not-used-in-test',
        role: 'ADMIN',
        isActive: true
      }
    });

    const boxOfficeUser = await prisma.adminUser.create({
      data: {
        username: 'dashboard-box-office',
        name: 'Dashboard Box Office',
        passwordHash: 'not-used-in-test',
        role: 'BOX_OFFICE',
        isActive: true
      }
    });

    adminToken = await app.jwt.sign({
      role: 'admin',
      adminId: adminUser.id,
      adminRole: adminUser.role,
      username: adminUser.username
    });

    boxOfficeToken = await app.jwt.sign({
      role: 'admin',
      adminId: boxOfficeUser.id,
      adminRole: boxOfficeUser.role,
      username: boxOfficeUser.username
    });

    seeded = await seedDashboardData();
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('returns only core/operations/quick links for BOX_OFFICE', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: authHeaders(boxOfficeToken)
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as DashboardPayload;

    expect(body.adminModules).toBeUndefined();
    expect(body.quickLinks.orders).toBe('/admin/orders');
    expect(body.quickLinks.scanner).toBe('/admin/scanner');
    expect(body.quickLinks.trips).toBeUndefined();
    expect(body.quickLinks.fundraise).toBeUndefined();
    expect(body.quickLinks.forms).toBeUndefined();
    expect(body.quickLinks.audit).toBeUndefined();
  });

  it('includes admin module blocks for ADMIN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: authHeaders(adminToken)
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as DashboardPayload;

    expect(body.adminModules).toBeTruthy();
    expect(body.adminModules?.trips).toBeTruthy();
    expect(body.adminModules?.fundraise).toBeTruthy();
    expect(body.adminModules?.forms).toBeTruthy();
    expect(body.adminModules?.system).toBeTruthy();

    expect(body.quickLinks.trips).toBe('/admin/trips');
    expect(body.quickLinks.fundraise).toBe('/admin/fundraise');
    expect(body.quickLinks.forms).toBe('/admin/forms');
    expect(body.quickLinks.audit).toBe('/admin/audit');

    expect(body.operations.upcomingPerformances.length).toBeLessThanOrEqual(5);
    expect(body.operations.recentOrders.length).toBeLessThanOrEqual(8);
  });

  it('uses month as default range and enforces today/rolling30 bounds', async () => {
    const now = new Date();

    const defaultResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: authHeaders(adminToken)
    });
    expect(defaultResponse.statusCode).toBe(200);
    const defaultBody = defaultResponse.json() as DashboardPayload;
    expect(defaultBody.range).toBe('month');

    const todayResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard?range=today',
      headers: authHeaders(adminToken)
    });
    expect(todayResponse.statusCode).toBe(200);
    const todayBody = todayResponse.json() as DashboardPayload;

    const rollingResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard?range=rolling30',
      headers: authHeaders(adminToken)
    });
    expect(rollingResponse.statusCode).toBe(200);
    const rollingBody = rollingResponse.json() as DashboardPayload;

    const expectedMonth = expectedCoreForRange('month', now);
    const expectedToday = expectedCoreForRange('today', now);
    const expectedRolling = expectedCoreForRange('rolling30', now);

    expect(defaultBody.core.paidRevenueCents).toBe(expectedMonth.paidRevenueCents);
    expect(defaultBody.core.paidOrderCount).toBe(expectedMonth.paidOrderCount);
    expect(defaultBody.core.ticketsIssuedCount).toBe(expectedMonth.ticketsIssuedCount);
    expect(defaultBody.core.checkInsCount).toBe(expectedMonth.checkInsCount);

    expect(todayBody.core.paidRevenueCents).toBe(expectedToday.paidRevenueCents);
    expect(todayBody.core.paidOrderCount).toBe(expectedToday.paidOrderCount);
    expect(todayBody.core.ticketsIssuedCount).toBe(expectedToday.ticketsIssuedCount);
    expect(todayBody.core.checkInsCount).toBe(expectedToday.checkInsCount);

    expect(rollingBody.core.paidRevenueCents).toBe(expectedRolling.paidRevenueCents);
    expect(rollingBody.core.paidOrderCount).toBe(expectedRolling.paidOrderCount);
    expect(rollingBody.core.ticketsIssuedCount).toBe(expectedRolling.ticketsIssuedCount);
    expect(rollingBody.core.checkInsCount).toBe(expectedRolling.checkInsCount);
  });

  it('computes trips/forms/fundraise summaries from seeded data', async () => {
    const now = new Date();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard?range=month',
      headers: authHeaders(adminToken)
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as DashboardPayload;
    expect(body.adminModules).toBeTruthy();

    expect(body.adminModules?.trips.activeTripCount).toBe(seeded.trips.activeTripCount);
    expect(body.adminModules?.trips.enrollmentCount).toBe(seeded.trips.enrollmentCount);
    expect(body.adminModules?.trips.collectedCents).toBe(seeded.trips.collectedCents);
    expect(body.adminModules?.trips.remainingCents).toBe(seeded.trips.remainingCents);
    expect(body.adminModules?.trips.nextDueAt).toBe(seeded.trips.nextDueAtIso);

    expect(body.adminModules?.forms.openCount).toBe(seeded.forms.openCount);
    expect(body.adminModules?.forms.closedCount).toBe(seeded.forms.closedCount);
    expect(body.adminModules?.forms.responseCount).toBe(seeded.forms.responseCount);
    expect(body.adminModules?.forms.programBio).toEqual(seeded.forms.programBio);
    expect(body.adminModules?.forms.seniorSendoff).toEqual(seeded.forms.seniorSendoff);

    expect(body.adminModules?.fundraise.activeEventCount).toBe(seeded.fundraise.activeEventCount);
    expect(body.adminModules?.fundraise.seatsSold).toBe(seeded.fundraise.seatsSold);
    expect(body.adminModules?.fundraise.seatsTotal).toBe(seeded.fundraise.seatsTotal);
    expect(body.adminModules?.fundraise.donationSucceededCents).toBe(expectedDonationForRange('month', now));

    expect(body.adminModules?.system.recentAudit.length).toBe(6);
  });

  it('returns donationSucceededCents as null when Stripe donation fetch fails', async () => {
    stripeState.failList = true;

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard?range=rolling30',
      headers: authHeaders(adminToken)
    });

    stripeState.failList = false;

    expect(response.statusCode).toBe(200);
    const body = response.json() as DashboardPayload;
    expect(body.adminModules?.fundraise.donationSucceededCents).toBeNull();
  });
});
