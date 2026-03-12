import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { createTicketSignature } from '../lib/qr.js';
import { logAudit } from '../lib/audit-log.js';

const scanAttemptActions = {
  INVALID_QR: 'SCAN_INVALID_QR',
  NOT_FOUND: 'SCAN_NOT_FOUND',
  WRONG_PERFORMANCE: 'SCAN_WRONG_PERFORMANCE',
  NOT_ADMITTED: 'SCAN_NOT_ADMITTED',
  ALREADY_CHECKED_IN: 'SCAN_ALREADY_CHECKED_IN'
} as const;

const supervisorReasonCodeSchema = z.enum([
  'DUPLICATE_SCAN',
  'VIP_OVERRIDE',
  'PAYMENT_EXCEPTION',
  'INVALID_TICKET',
  'SAFETY_CONCERN',
  'MANUAL_CORRECTION',
  'OTHER'
]);

const startSessionSchema = z.object({
  performanceId: z.string().min(1),
  staffName: z.string().trim().min(2).max(80),
  gate: z.string().trim().min(1).max(64),
  deviceLabel: z.string().trim().max(80).optional()
});

const endSessionSchema = z.object({
  sessionToken: z.string().min(8)
});

const scanTicketSchema = z.object({
  performanceId: z.string().min(1),
  sessionToken: z.string().min(8),
  scannedValue: z.string().min(1),
  clientScanId: z.string().min(1).max(80).optional(),
  offlineQueuedAt: z.string().datetime().optional()
});

const undoCheckInSchema = z
  .object({
    performanceId: z.string().min(1),
    sessionToken: z.string().min(8),
    ticketId: z.string().min(1).optional(),
    publicId: z.string().min(1).optional(),
    reasonCode: supervisorReasonCodeSchema,
    notes: z.string().trim().max(200).optional()
  })
  .refine((value) => Boolean(value.ticketId || value.publicId), {
    message: 'Provide ticketId or publicId'
  });

const forceDecisionSchema = z
  .object({
    performanceId: z.string().min(1),
    sessionToken: z.string().min(8),
    ticketId: z.string().min(1).optional(),
    publicId: z.string().min(1).optional(),
    decision: z.enum(['FORCE_ADMIT', 'DENY']),
    reasonCode: supervisorReasonCodeSchema,
    notes: z.string().trim().max(200).optional()
  })
  .refine((value) => Boolean(value.ticketId || value.publicId), {
    message: 'Provide ticketId or publicId'
  });

const summaryQuerySchema = z.object({
  performanceId: z.string().min(1)
});

const lookupQuerySchema = z.object({
  performanceId: z.string().min(1),
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const timelineQuerySchema = z.object({
  performanceId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const analyticsQuerySchema = z.object({
  performanceId: z.string().min(1)
});

const sseQuerySchema = z.object({
  performanceId: z.string().min(1),
  token: z.string().min(8)
});

type ScanOutcome =
  | 'VALID'
  | 'ALREADY_CHECKED_IN'
  | 'WRONG_PERFORMANCE'
  | 'NOT_ADMITTED'
  | 'INVALID_QR'
  | 'NOT_FOUND';

type TicketPayload = {
  id: string;
  publicId: string;
  performanceId: string;
  performanceTitle: string;
  startsAt: string;
  venue: string;
  seat: {
    sectionName: string;
    row: string;
    number: number;
  };
  holder: {
    customerName: string;
    customerEmail: string;
  };
  order: {
    id: string;
    status: string;
  };
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null;
  admissionReason: string | null;
};

type TicketScanResponse = {
  outcome: ScanOutcome;
  message: string;
  scannedAt: string;
  ticket?: TicketPayload;
};

type ScanReference =
  | { kind: 'qr'; ticketId: string; signature: string }
  | { kind: 'publicId'; publicId: string }
  | { kind: 'invalid' };

type SseClient = {
  id: string;
  write: (chunk: string) => boolean;
};

const sseClientsByPerformance = new Map<string, Map<string, SseClient>>();

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeScannedInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/\/tickets\/([^/]+)/i);
      if (match?.[1]) return decodeURIComponent(match[1]).trim();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function parseScanReference(value: string): ScanReference {
  const normalized = normalizeScannedInput(value);
  if (!normalized) return { kind: 'invalid' };

  const dotParts = normalized.split('.');
  if (
    dotParts.length === 2 &&
    /^[a-z0-9-]{8,}$/i.test(dotParts[0]) &&
    /^[a-z0-9_-]{8,}$/i.test(dotParts[1])
  ) {
    return {
      kind: 'qr',
      ticketId: dotParts[0],
      signature: dotParts[1]
    };
  }

  if (/^[a-z0-9]+$/i.test(normalized) && normalized.length >= 8) {
    return {
      kind: 'publicId',
      publicId: normalized
    };
  }

  return { kind: 'invalid' };
}

function makeReasonText(reasonCode: z.infer<typeof supervisorReasonCodeSchema>, notes?: string): string {
  return notes?.trim() ? `${reasonCode}: ${notes.trim()}` : reasonCode;
}

function buildClientId() {
  return crypto.randomBytes(8).toString('hex');
}

function toMinuteBucket(date: Date): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy.toISOString();
}

function registerSseClient(performanceId: string, client: SseClient): () => void {
  const performanceClients = sseClientsByPerformance.get(performanceId) || new Map<string, SseClient>();
  performanceClients.set(client.id, client);
  sseClientsByPerformance.set(performanceId, performanceClients);

  return () => {
    const current = sseClientsByPerformance.get(performanceId);
    if (!current) return;
    current.delete(client.id);
    if (current.size === 0) sseClientsByPerformance.delete(performanceId);
  };
}

function broadcastPerformanceEvent(performanceId: string, eventName: string, payload: unknown): void {
  const clients = sseClientsByPerformance.get(performanceId);
  if (!clients || clients.size === 0) return;

  const serialized = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const deadClientIds: string[] = [];
  clients.forEach((client, clientId) => {
    const ok = client.write(serialized);
    if (!ok) {
      deadClientIds.push(clientId);
    }
  });

  deadClientIds.forEach((clientId) => clients.delete(clientId));
  if (clients.size === 0) {
    sseClientsByPerformance.delete(performanceId);
  }
}

async function resolveActiveSession(performanceId: string, sessionToken: string) {
  const session = await prisma.scannerSession.findFirst({
    where: {
      performanceId,
      accessToken: sessionToken,
      active: true
    }
  });
  if (!session) {
    throw new HttpError(401, 'Scanner session is not active');
  }

  await prisma.scannerSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  });

  return session;
}

async function getTicketByReference(reference: ScanReference) {
  if (reference.kind === 'invalid') return null;

  return reference.kind === 'qr'
    ? prisma.ticket.findUnique({
        where: { id: reference.ticketId },
        include: {
          seat: true,
          order: true,
          performance: { include: { show: true } }
        }
      })
    : prisma.ticket.findUnique({
        where: { publicId: reference.publicId },
        include: {
          seat: true,
          order: true,
          performance: { include: { show: true } }
        }
      });
}

function toTicketPayload(ticket: {
  id: string;
  publicId: string;
  performanceId: string;
  performance: { title: string | null; startsAt: Date; venue: string; show: { title: string } };
  seat: { sectionName: string; row: string; number: number };
  order: { id: string; status: string; customerName: string; email: string };
  checkedInAt: Date | null;
  checkedInBy: string | null;
  checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null;
  admissionReason: string | null;
}): TicketPayload {
  return {
    id: ticket.id,
    publicId: ticket.publicId,
    performanceId: ticket.performanceId,
    performanceTitle: ticket.performance.title || ticket.performance.show.title,
    startsAt: ticket.performance.startsAt.toISOString(),
    venue: ticket.performance.venue,
    seat: {
      sectionName: ticket.seat.sectionName,
      row: ticket.seat.row,
      number: ticket.seat.number
    },
    holder: {
      customerName: ticket.order.customerName,
      customerEmail: ticket.order.email
    },
    order: {
      id: ticket.order.id,
      status: ticket.order.status
    },
    checkedInAt: ticket.checkedInAt?.toISOString() || null,
    checkedInBy: ticket.checkedInBy || null,
    checkInGate: ticket.checkInGate || null,
    admissionDecision: ticket.admissionDecision || null,
    admissionReason: ticket.admissionReason || null
  };
}

async function logScanAttempt(params: {
  actor: string;
  action: string;
  performanceId: string;
  ticketId?: string | null;
  publicId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await logAudit({
    actor: params.actor,
    action: params.action,
    entityType: 'Ticket',
    entityId: params.ticketId || params.publicId || 'unknown',
    metadata: {
      performanceId: params.performanceId,
      ticketId: params.ticketId || null,
      publicId: params.publicId || null,
      ...(params.metadata || {})
    }
  });
}

async function computeCheckInAnalytics(performanceId: string) {
  const [performance, tickets, attemptLogs] = await Promise.all([
    prisma.performance.findUnique({
      where: { id: performanceId },
      include: { show: true }
    }),
    prisma.ticket.findMany({
      where: { performanceId },
      include: { order: true }
    }),
    prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            scanAttemptActions.INVALID_QR,
            scanAttemptActions.NOT_FOUND,
            scanAttemptActions.WRONG_PERFORMANCE,
            scanAttemptActions.NOT_ADMITTED,
            scanAttemptActions.ALREADY_CHECKED_IN
          ]
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5000
    })
  ]);

  if (!performance) {
    throw new HttpError(404, 'Performance not found');
  }

  const relevantAttemptLogs = attemptLogs.filter((row) => {
    const meta = row.metadataJson as { performanceId?: string } | null;
    return meta?.performanceId === performanceId;
  });

  const totalAdmittable = tickets.filter((ticket) => ticket.status === 'ISSUED' && ticket.order.status === 'PAID').length;
  const checkedInTickets = tickets.filter((ticket) => ticket.checkedInAt);
  const totalCheckedIn = checkedInTickets.length;
  const noShowEstimate = Math.max(0, totalAdmittable - totalCheckedIn);

  const gateMap = new Map<string, number>();
  const minuteMap = new Map<string, number>();
  const gateMinuteMap = new Map<string, number>();
  checkedInTickets.forEach((ticket) => {
    const gate = ticket.checkInGate || 'Unspecified';
    gateMap.set(gate, (gateMap.get(gate) || 0) + 1);

    const minute = toMinuteBucket(ticket.checkedInAt!);
    minuteMap.set(minute, (minuteMap.get(minute) || 0) + 1);
    gateMinuteMap.set(`${minute}|${gate}`, (gateMinuteMap.get(`${minute}|${gate}`) || 0) + 1);
  });

  const timeline = [...minuteMap.entries()]
    .map(([minute, count]) => ({
      minute,
      count
    }))
    .sort((a, b) => a.minute.localeCompare(b.minute));

  const byGate = [...gateMap.entries()]
    .map(([gate, count]) => ({ gate, count }))
    .sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate));

  const peakPerMinute = timeline.reduce((max, row) => Math.max(max, row.count), 0);

  const attemptCounts = {
    duplicateAttempts: relevantAttemptLogs.filter((row) => row.action === scanAttemptActions.ALREADY_CHECKED_IN).length,
    invalidQrAttempts: relevantAttemptLogs.filter((row) => row.action === scanAttemptActions.INVALID_QR).length,
    notFoundAttempts: relevantAttemptLogs.filter((row) => row.action === scanAttemptActions.NOT_FOUND).length,
    wrongPerformanceAttempts: relevantAttemptLogs.filter((row) => row.action === scanAttemptActions.WRONG_PERFORMANCE).length,
    notAdmittedAttempts: relevantAttemptLogs.filter((row) => row.action === scanAttemptActions.NOT_ADMITTED).length
  };
  const fraudAttemptEstimate = attemptCounts.invalidQrAttempts + attemptCounts.notFoundAttempts;

  return {
    performance: {
      id: performance.id,
      title: performance.title || performance.show.title,
      startsAt: performance.startsAt.toISOString(),
      venue: performance.venue
    },
    totals: {
      totalAdmittable,
      totalCheckedIn,
      noShowEstimate,
      checkInRate: totalAdmittable > 0 ? Number(((totalCheckedIn / totalAdmittable) * 100).toFixed(2)) : 0
    },
    attempts: {
      ...attemptCounts,
      fraudAttemptEstimate
    },
    supervisorDecisions: {
      forceAdmitCount: tickets.filter((ticket) => ticket.admissionDecision === 'FORCE_ADMIT').length,
      denyCount: tickets.filter((ticket) => ticket.admissionDecision === 'DENY').length
    },
    peakPerMinute,
    byGate,
    timeline
  };
}

export const adminCheckInRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/admin/check-in/session/start', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = startSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: parsed.data.performanceId },
        select: { id: true }
      });
      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      const session = await prisma.scannerSession.create({
        data: {
          performanceId: parsed.data.performanceId,
          accessToken: crypto.randomBytes(24).toString('base64url'),
          staffName: parsed.data.staffName.trim(),
          gate: parsed.data.gate.trim(),
          deviceLabel: parsed.data.deviceLabel?.trim() || null,
          createdBy: request.user.username || 'admin'
        }
      });

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'SCANNER_SESSION_STARTED',
        entityType: 'ScannerSession',
        entityId: session.id,
        metadata: {
          performanceId: session.performanceId,
          staffName: session.staffName,
          gate: session.gate,
          deviceLabel: session.deviceLabel
        }
      });

      broadcastPerformanceEvent(session.performanceId, 'session', {
        type: 'SESSION_STARTED',
        at: new Date().toISOString(),
        gate: session.gate,
        staffName: session.staffName
      });

      reply.send({
        sessionId: session.id,
        sessionToken: session.accessToken,
        performanceId: session.performanceId,
        staffName: session.staffName,
        gate: session.gate,
        deviceLabel: session.deviceLabel,
        createdAt: session.createdAt.toISOString()
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to start scanner session');
    }
  });

  app.post('/api/admin/check-in/session/end', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = endSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const session = await prisma.scannerSession.findUnique({
        where: { accessToken: parsed.data.sessionToken }
      });
      if (!session) {
        throw new HttpError(404, 'Scanner session not found');
      }

      await prisma.scannerSession.update({
        where: { id: session.id },
        data: {
          active: false,
          endedAt: new Date(),
          lastSeenAt: new Date()
        }
      });

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'SCANNER_SESSION_ENDED',
        entityType: 'ScannerSession',
        entityId: session.id,
        metadata: {
          performanceId: session.performanceId,
          staffName: session.staffName,
          gate: session.gate
        }
      });

      broadcastPerformanceEvent(session.performanceId, 'session', {
        type: 'SESSION_ENDED',
        at: new Date().toISOString(),
        gate: session.gate,
        staffName: session.staffName
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to end scanner session');
    }
  });

  app.get('/api/admin/check-in/events', async (request, reply) => {
    const parsed = sseQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const payload = await app.jwt.verify<{ role?: string; username?: string }>(parsed.data.token);
      if (payload.role !== 'admin') {
        throw new HttpError(403, 'Forbidden');
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      const clientId = buildClientId();
      const client: SseClient = {
        id: clientId,
        write: (chunk) => reply.raw.write(chunk)
      };
      const unsubscribe = registerSseClient(parsed.data.performanceId, client);

      const keepAlive = setInterval(() => {
        reply.raw.write(`event: ping\ndata: {"t":"${new Date().toISOString()}"}\n\n`);
      }, 15000);

      reply.raw.write(`event: ready\ndata: {"performanceId":"${parsed.data.performanceId}"}\n\n`);

      request.raw.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to start realtime stream');
    }
  });

  app.post('/api/admin/check-in/scan', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = scanTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const scannedAt = new Date();

    try {
      const selectedPerformance = await prisma.performance.findUnique({
        where: { id: parsed.data.performanceId },
        include: { show: true }
      });
      if (!selectedPerformance) {
        throw new HttpError(404, 'Performance not found');
      }

      const scannerSession = await resolveActiveSession(parsed.data.performanceId, parsed.data.sessionToken);
      const actor = `${scannerSession.staffName} @ ${scannerSession.gate}`;

      const reference = parseScanReference(parsed.data.scannedValue);
      if (reference.kind === 'invalid') {
        await logScanAttempt({
          actor,
          action: scanAttemptActions.INVALID_QR,
          performanceId: parsed.data.performanceId,
          metadata: {
            scannedValue: parsed.data.scannedValue,
            sessionId: scannerSession.id,
            clientScanId: parsed.data.clientScanId || null,
            offlineQueuedAt: parsed.data.offlineQueuedAt || null
          }
        });

        return reply.send({
          outcome: 'INVALID_QR',
          message: 'Unrecognized ticket code format.',
          scannedAt: scannedAt.toISOString()
        } satisfies TicketScanResponse);
      }

      const ticket = await getTicketByReference(reference);
      if (!ticket) {
        await logScanAttempt({
          actor,
          action: scanAttemptActions.NOT_FOUND,
          performanceId: parsed.data.performanceId,
          metadata: {
            scannedValue: parsed.data.scannedValue,
            sessionId: scannerSession.id,
            clientScanId: parsed.data.clientScanId || null,
            offlineQueuedAt: parsed.data.offlineQueuedAt || null
          }
        });

        return reply.send({
          outcome: 'NOT_FOUND',
          message: 'Ticket not found.',
          scannedAt: scannedAt.toISOString()
        } satisfies TicketScanResponse);
      }

      if (reference.kind === 'qr') {
        const expected = createTicketSignature(ticket.id, ticket.qrSecret);
        if (!constantTimeEqual(expected, reference.signature)) {
          await logScanAttempt({
            actor,
            action: scanAttemptActions.INVALID_QR,
            performanceId: parsed.data.performanceId,
            ticketId: ticket.id,
            publicId: ticket.publicId,
            metadata: {
              reason: 'bad_signature',
              sessionId: scannerSession.id,
              clientScanId: parsed.data.clientScanId || null
            }
          });

          return reply.send({
            outcome: 'INVALID_QR',
            message: 'Ticket signature is invalid.',
            scannedAt: scannedAt.toISOString()
          } satisfies TicketScanResponse);
        }
      }

      const baseTicket = toTicketPayload(ticket);

      if (ticket.performanceId !== selectedPerformance.id) {
        await logScanAttempt({
          actor,
          action: scanAttemptActions.WRONG_PERFORMANCE,
          performanceId: parsed.data.performanceId,
          ticketId: ticket.id,
          publicId: ticket.publicId,
          metadata: {
            ticketPerformanceId: ticket.performanceId,
            sessionId: scannerSession.id
          }
        });

        return reply.send({
          outcome: 'WRONG_PERFORMANCE',
          message: `Ticket belongs to ${baseTicket.performanceTitle}, not the selected performance.`,
          scannedAt: scannedAt.toISOString(),
          ticket: baseTicket
        } satisfies TicketScanResponse);
      }

      if (ticket.admissionDecision === 'DENY') {
        await logScanAttempt({
          actor,
          action: scanAttemptActions.NOT_ADMITTED,
          performanceId: parsed.data.performanceId,
          ticketId: ticket.id,
          publicId: ticket.publicId,
          metadata: {
            reason: ticket.admissionReason || 'Supervisor denied',
            sessionId: scannerSession.id
          }
        });

        return reply.send({
          outcome: 'NOT_ADMITTED',
          message: `Ticket denied by supervisor${ticket.admissionReason ? ` (${ticket.admissionReason})` : ''}.`,
          scannedAt: scannedAt.toISOString(),
          ticket: baseTicket
        } satisfies TicketScanResponse);
      }

      if (ticket.order.status !== 'PAID' || ticket.status !== 'ISSUED') {
        await logScanAttempt({
          actor,
          action: scanAttemptActions.NOT_ADMITTED,
          performanceId: parsed.data.performanceId,
          ticketId: ticket.id,
          publicId: ticket.publicId,
          metadata: {
            orderStatus: ticket.order.status,
            ticketStatus: ticket.status,
            sessionId: scannerSession.id
          }
        });

        return reply.send({
          outcome: 'NOT_ADMITTED',
          message: `Ticket cannot be admitted (order ${ticket.order.status}, ticket ${ticket.status}).`,
          scannedAt: scannedAt.toISOString(),
          ticket: baseTicket
        } satisfies TicketScanResponse);
      }

      if (ticket.checkedInAt) {
        await logScanAttempt({
          actor,
          action: scanAttemptActions.ALREADY_CHECKED_IN,
          performanceId: parsed.data.performanceId,
          ticketId: ticket.id,
          publicId: ticket.publicId,
          metadata: {
            checkedInAt: ticket.checkedInAt.toISOString(),
            sessionId: scannerSession.id
          }
        });

        return reply.send({
          outcome: 'ALREADY_CHECKED_IN',
          message: `Ticket already checked in at ${ticket.checkedInAt.toLocaleString()}.`,
          scannedAt: scannedAt.toISOString(),
          ticket: baseTicket
        } satisfies TicketScanResponse);
      }

      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          checkedInAt: null
        },
        data: {
          checkedInAt: scannedAt,
          checkedInBy: actor,
          checkInGate: scannerSession.gate
        }
      });

      if (updated.count === 0) {
        const alreadyCheckedIn = await prisma.ticket.findUnique({
          where: { id: ticket.id },
          include: {
            seat: true,
            order: true,
            performance: { include: { show: true } }
          }
        });

        await logScanAttempt({
          actor,
          action: scanAttemptActions.ALREADY_CHECKED_IN,
          performanceId: parsed.data.performanceId,
          ticketId: ticket.id,
          publicId: ticket.publicId,
          metadata: {
            reason: 'race_condition',
            sessionId: scannerSession.id
          }
        });

        return reply.send({
          outcome: 'ALREADY_CHECKED_IN',
          message: `Ticket already checked in at ${alreadyCheckedIn?.checkedInAt?.toLocaleString() || 'an earlier scan'}.`,
          scannedAt: scannedAt.toISOString(),
          ticket: alreadyCheckedIn ? toTicketPayload(alreadyCheckedIn) : baseTicket
        } satisfies TicketScanResponse);
      }

      await logAudit({
        actor,
        action: 'TICKET_CHECKED_IN',
        entityType: 'Ticket',
        entityId: ticket.id,
        metadata: {
          performanceId: ticket.performanceId,
          publicId: ticket.publicId,
          gate: scannerSession.gate,
          sessionId: scannerSession.id,
          clientScanId: parsed.data.clientScanId || null,
          offlineQueuedAt: parsed.data.offlineQueuedAt || null
        }
      });

      const payload: TicketScanResponse = {
        outcome: 'VALID',
        message: 'Ticket checked in successfully.',
        scannedAt: scannedAt.toISOString(),
        ticket: {
          ...baseTicket,
          checkedInAt: scannedAt.toISOString(),
          checkedInBy: actor,
          checkInGate: scannerSession.gate
        }
      };

      broadcastPerformanceEvent(parsed.data.performanceId, 'checkin', {
        type: 'CHECKIN',
        at: scannedAt.toISOString(),
        ticketId: ticket.id,
        publicId: ticket.publicId,
        gate: scannerSession.gate,
        staffName: scannerSession.staffName
      });

      return reply.send(payload);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to scan ticket');
    }
  });

  app.post('/api/admin/check-in/undo', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = undoCheckInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const session = await resolveActiveSession(parsed.data.performanceId, parsed.data.sessionToken);
      const actor = `${session.staffName} @ ${session.gate}`;

      const ticket = await prisma.ticket.findFirst({
        where: {
          performanceId: parsed.data.performanceId,
          ...(parsed.data.ticketId ? { id: parsed.data.ticketId } : {}),
          ...(parsed.data.publicId ? { publicId: parsed.data.publicId } : {})
        },
        include: {
          seat: true,
          order: true,
          performance: { include: { show: true } }
        }
      });
      if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
      }

      const baseTicket = toTicketPayload(ticket);
      if (!ticket.checkedInAt) {
        return reply.send({
          success: false,
          message: 'Ticket is not currently checked in.',
          ticket: baseTicket
        });
      }

      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          performanceId: parsed.data.performanceId,
          checkedInAt: { not: null }
        },
        data: {
          checkedInAt: null,
          checkedInBy: null,
          checkInGate: null
        }
      });

      if (updated.count === 0) {
        return reply.send({
          success: false,
          message: 'Ticket check-in was already removed.',
          ticket: {
            ...baseTicket,
            checkedInAt: null,
            checkedInBy: null,
            checkInGate: null
          }
        });
      }

      await logAudit({
        actor,
        action: 'TICKET_CHECKIN_UNDONE',
        entityType: 'Ticket',
        entityId: ticket.id,
        metadata: {
          performanceId: parsed.data.performanceId,
          publicId: ticket.publicId,
          reasonCode: parsed.data.reasonCode,
          reasonText: makeReasonText(parsed.data.reasonCode, parsed.data.notes),
          sessionId: session.id
        }
      });

      broadcastPerformanceEvent(parsed.data.performanceId, 'checkin', {
        type: 'UNDO',
        at: new Date().toISOString(),
        ticketId: ticket.id,
        publicId: ticket.publicId
      });

      return reply.send({
        success: true,
        message: 'Check-in removed.',
        ticket: {
          ...baseTicket,
          checkedInAt: null,
          checkedInBy: null,
          checkInGate: null
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to undo check-in');
    }
  });

  app.post('/api/admin/check-in/force-decision', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = forceDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const session = await resolveActiveSession(parsed.data.performanceId, parsed.data.sessionToken);
      const actor = `${session.staffName} @ ${session.gate}`;

      const ticket = await prisma.ticket.findFirst({
        where: {
          performanceId: parsed.data.performanceId,
          ...(parsed.data.ticketId ? { id: parsed.data.ticketId } : {}),
          ...(parsed.data.publicId ? { publicId: parsed.data.publicId } : {})
        },
        include: {
          seat: true,
          order: true,
          performance: { include: { show: true } }
        }
      });
      if (!ticket) {
        throw new HttpError(404, 'Ticket not found');
      }

      const decidedAt = new Date();
      const reasonText = makeReasonText(parsed.data.reasonCode, parsed.data.notes);

      const data =
        parsed.data.decision === 'FORCE_ADMIT'
          ? {
              admissionDecision: 'FORCE_ADMIT' as const,
              admissionReason: reasonText,
              admissionDecidedAt: decidedAt,
              admissionDecidedBy: actor,
              checkedInAt: ticket.checkedInAt || decidedAt,
              checkedInBy: actor,
              checkInGate: session.gate
            }
          : {
              admissionDecision: 'DENY' as const,
              admissionReason: reasonText,
              admissionDecidedAt: decidedAt,
              admissionDecidedBy: actor,
              checkedInAt: null,
              checkedInBy: null,
              checkInGate: null
            };

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data,
        include: {
          seat: true,
          order: true,
          performance: { include: { show: true } }
        }
      });

      await logAudit({
        actor,
        action: parsed.data.decision === 'FORCE_ADMIT' ? 'TICKET_FORCE_ADMITTED' : 'TICKET_FORCE_DENIED',
        entityType: 'Ticket',
        entityId: ticket.id,
        metadata: {
          performanceId: parsed.data.performanceId,
          publicId: ticket.publicId,
          decision: parsed.data.decision,
          reasonCode: parsed.data.reasonCode,
          reasonText,
          sessionId: session.id
        }
      });

      broadcastPerformanceEvent(parsed.data.performanceId, 'decision', {
        type: parsed.data.decision,
        at: decidedAt.toISOString(),
        ticketId: ticket.id,
        publicId: ticket.publicId
      });

      return reply.send({
        success: true,
        decision: parsed.data.decision,
        message: parsed.data.decision === 'FORCE_ADMIT' ? 'Ticket force-admitted.' : 'Ticket denied.',
        ticket: toTicketPayload(updated)
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to apply supervisor decision');
    }
  });

  app.get('/api/admin/check-in/summary', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: parsed.data.performanceId },
        include: { show: true }
      });
      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      const [totalCheckedIn, totalAdmittable, groupedByGate, recent, activeSessions, deniedCount, forceAdmitCount] = await Promise.all([
        prisma.ticket.count({
          where: {
            performanceId: performance.id,
            checkedInAt: { not: null }
          }
        }),
        prisma.ticket.count({
          where: {
            performanceId: performance.id,
            status: 'ISSUED',
            order: {
              status: 'PAID'
            }
          }
        }),
        prisma.ticket.groupBy({
          by: ['checkInGate'],
          where: {
            performanceId: performance.id,
            checkedInAt: { not: null }
          },
          _count: {
            _all: true
          }
        }),
        prisma.ticket.findMany({
          where: {
            performanceId: performance.id,
            checkedInAt: { not: null }
          },
          orderBy: {
            checkedInAt: 'desc'
          },
          take: 30,
          include: {
            seat: true,
            order: true
          }
        }),
        prisma.scannerSession.findMany({
          where: {
            performanceId: performance.id,
            active: true
          },
          orderBy: { createdAt: 'asc' }
        }),
        prisma.ticket.count({
          where: {
            performanceId: performance.id,
            admissionDecision: 'DENY'
          }
        }),
        prisma.ticket.count({
          where: {
            performanceId: performance.id,
            admissionDecision: 'FORCE_ADMIT'
          }
        })
      ]);

      const gateBreakdown = groupedByGate
        .map((row) => ({
          gate: row.checkInGate || 'Unspecified',
          count: row._count._all
        }))
        .sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate));

      reply.send({
        performance: {
          id: performance.id,
          title: performance.title || performance.show.title,
          startsAt: performance.startsAt.toISOString(),
          venue: performance.venue
        },
        totalCheckedIn,
        totalAdmittable,
        deniedCount,
        forceAdmitCount,
        gateBreakdown,
        activeSessions: activeSessions.map((session) => ({
          id: session.id,
          staffName: session.staffName,
          gate: session.gate,
          deviceLabel: session.deviceLabel,
          startedAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString()
        })),
        recent: recent.map((ticket) => ({
          id: ticket.id,
          publicId: ticket.publicId,
          checkedInAt: ticket.checkedInAt?.toISOString() || null,
          checkedInBy: ticket.checkedInBy || null,
          checkInGate: ticket.checkInGate || 'Unspecified',
          seat: {
            sectionName: ticket.seat.sectionName,
            row: ticket.seat.row,
            number: ticket.seat.number
          },
          holder: {
            customerName: ticket.order.customerName,
            customerEmail: ticket.order.email
          }
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load check-in summary');
    }
  });

  app.get('/api/admin/check-in/lookup', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = lookupQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const q = parsed.data.q.trim();
      const qUpper = q.toUpperCase();
      const parsedSeatNumber = Number(q);

      const tickets = await prisma.ticket.findMany({
        where: {
          performanceId: parsed.data.performanceId,
          OR: [
            { publicId: { contains: q, mode: 'insensitive' } },
            { id: { contains: q, mode: 'insensitive' } },
            { order: { is: { id: { contains: q, mode: 'insensitive' } } } },
            { order: { is: { customerName: { contains: q, mode: 'insensitive' } } } },
            { order: { is: { email: { contains: q, mode: 'insensitive' } } } },
            { seat: { is: { sectionName: { contains: q, mode: 'insensitive' } } } },
            { seat: { is: { row: { equals: qUpper, mode: 'insensitive' } } } },
            ...(Number.isFinite(parsedSeatNumber) ? [{ seat: { is: { number: Math.floor(parsedSeatNumber) } } }] : [])
          ]
        },
        include: {
          seat: true,
          order: true,
          performance: { include: { show: true } }
        },
        orderBy: [{ checkedInAt: 'desc' }, { createdAt: 'desc' }],
        take: parsed.data.limit
      });

      reply.send(
        tickets.map((ticket) => ({
          ...toTicketPayload(ticket),
          ticketStatus: ticket.status,
          ticketType: ticket.type,
          createdAt: ticket.createdAt.toISOString()
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'Failed to search tickets');
    }
  });

  app.get('/api/admin/check-in/timeline', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = timelineQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const timelineActions = [
      'TICKET_CHECKED_IN',
      'TICKET_CHECKIN_UNDONE',
      'TICKET_FORCE_ADMITTED',
      'TICKET_FORCE_DENIED',
      scanAttemptActions.ALREADY_CHECKED_IN,
      scanAttemptActions.INVALID_QR,
      scanAttemptActions.NOT_ADMITTED,
      scanAttemptActions.NOT_FOUND,
      scanAttemptActions.WRONG_PERFORMANCE
    ];

    try {
      const rawRows = await prisma.auditLog.findMany({
        where: {
          action: { in: timelineActions }
        },
        orderBy: { createdAt: 'desc' },
        take: 5000
      });

      const filtered = rawRows.filter((row) => {
        const meta = row.metadataJson as { performanceId?: string } | null;
        return meta?.performanceId === parsed.data.performanceId;
      });

      const start = (parsed.data.page - 1) * parsed.data.pageSize;
      const pageRows = filtered.slice(start, start + parsed.data.pageSize);

      reply.send({
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total: filtered.length,
        rows: pageRows.map((row) => ({
          id: row.id,
          action: row.action,
          actor: row.actor,
          entityId: row.entityId,
          createdAt: row.createdAt.toISOString(),
          metadata: row.metadataJson
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load check-in timeline');
    }
  });

  app.get('/api/admin/check-in/analytics', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const analytics = await computeCheckInAnalytics(parsed.data.performanceId);
      reply.send(analytics);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to compute check-in analytics');
    }
  });

  app.get('/api/admin/check-in/analytics.csv', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const analytics = await computeCheckInAnalytics(parsed.data.performanceId);
      const lines: string[] = [];
      lines.push(`Metric,Value`);
      lines.push(`Performance,"${analytics.performance.title.replace(/"/g, '""')}"`);
      lines.push(`Starts At,${analytics.performance.startsAt}`);
      lines.push(`Venue,"${analytics.performance.venue.replace(/"/g, '""')}"`);
      lines.push(`Total Admittable,${analytics.totals.totalAdmittable}`);
      lines.push(`Total Checked In,${analytics.totals.totalCheckedIn}`);
      lines.push(`No Show Estimate,${analytics.totals.noShowEstimate}`);
      lines.push(`Check In Rate %,${analytics.totals.checkInRate}`);
      lines.push(`Peak Per Minute,${analytics.peakPerMinute}`);
      lines.push(`Duplicate Attempts,${analytics.attempts.duplicateAttempts}`);
      lines.push(`Invalid QR Attempts,${analytics.attempts.invalidQrAttempts}`);
      lines.push(`Not Found Attempts,${analytics.attempts.notFoundAttempts}`);
      lines.push(`Wrong Performance Attempts,${analytics.attempts.wrongPerformanceAttempts}`);
      lines.push(`Not Admitted Attempts,${analytics.attempts.notAdmittedAttempts}`);
      lines.push(`Fraud Attempt Estimate,${analytics.attempts.fraudAttemptEstimate}`);
      lines.push(`Force Admit Count,${analytics.supervisorDecisions.forceAdmitCount}`);
      lines.push(`Deny Count,${analytics.supervisorDecisions.denyCount}`);
      lines.push(``);
      lines.push(`Gate,Count`);
      analytics.byGate.forEach((row) => lines.push(`"${row.gate.replace(/"/g, '""')}",${row.count}`));
      lines.push(``);
      lines.push(`Minute,Count`);
      analytics.timeline.forEach((row) => lines.push(`${row.minute},${row.count}`));

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="checkin-analytics-${parsed.data.performanceId}.csv"`);
      reply.send(lines.join('\n'));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to export analytics CSV');
    }
  });
};

