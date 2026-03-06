import { FastifyPluginAsync } from 'fastify';
import { Prisma, StudentCreditVerificationMethod, StudentCreditTransactionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';
import {
  finalizeStudentCreditForOrderTx,
  generateStudentVerificationCode,
  getStudentCreditEligibilityByCode,
  issueUniqueStudentVerificationCode,
  manualRedeemStudentCredit,
  manualRestoreStudentCredit,
  normalizeStudentVerificationCode,
  studentCreditRemainingTickets
} from '../services/student-ticket-credit-service.js';

const createStudentCreditSchema = z.object({
  studentId: z.string().min(1).max(120).optional(),
  studentName: z.string().min(1).max(120),
  studentEmail: z.string().email().optional().nullable(),
  roleName: z.string().max(120).optional().nullable(),
  verificationCode: z.string().min(4).max(64).optional().nullable(),
  allocatedTickets: z.number().int().min(0).max(50).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(600).optional().nullable()
});

const updateStudentCreditSchema = z.object({
  studentId: z.string().min(1).max(120).optional().nullable(),
  studentName: z.string().min(1).max(120).optional(),
  studentEmail: z.string().email().optional().nullable(),
  roleName: z.string().max(120).optional().nullable(),
  verificationCode: z.string().min(4).max(64).optional().nullable(),
  allocatedTickets: z.number().int().min(0).max(50).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(600).optional().nullable()
});

const importStudentCreditsSchema = z.object({
  csv: z.string().min(1)
});

const manualActionSchema = z.object({
  quantity: z.number().int().min(1).max(50),
  performanceId: z.string().min(1).optional(),
  notes: z.string().max(600).optional()
});

const validateStudentCreditSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  verification: z.object({
    method: z.enum(['code', 'school_login']).default('code'),
    code: z.string().min(4).max(64).optional()
  })
});

const quoteStudentCreditSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelections: z
    .array(
      z.object({
        tierId: z.string().min(1),
        count: z.number().int().min(0).max(50)
      })
    )
    .optional(),
  verification: z.object({
    method: z.enum(['code', 'school_login']).default('code'),
    code: z.string().min(4).max(64).optional()
  })
});

const finalizeStudentCreditSchema = z.object({
  orderId: z.string().min(1),
  email: z.string().email()
});

type SeatAssignment = {
  seatId: string;
  sectionName: string;
  row: string;
  number: number;
  priceCents: number;
  ticketType: string | null;
};

type AdminRequestUser = { user: { username?: string } };

function adminActor(request: AdminRequestUser): string {
  return request.user.username || 'admin';
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseStudentCreditCsv(csvText: string): Array<{
  studentName: string;
  studentEmail: string | null;
  roleName: string | null;
  allocatedTickets: number;
}> {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const nameIndex = headers.indexOf('studentname');
  const emailIndex = headers.indexOf('studentemail');
  const roleIndex = headers.indexOf('rolename');
  const allocatedIndex = headers.indexOf('allocatedtickets');

  if (nameIndex < 0) {
    throw new HttpError(400, 'CSV must include studentName column');
  }

  const rows: Array<{
    studentName: string;
    studentEmail: string | null;
    roleName: string | null;
    allocatedTickets: number;
  }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const columns = parseCsvLine(lines[i]);
    const studentName = (columns[nameIndex] || '').trim();
    if (!studentName) {
      continue;
    }

    const studentEmailRaw = emailIndex >= 0 ? (columns[emailIndex] || '').trim().toLowerCase() : '';
    const roleNameRaw = roleIndex >= 0 ? (columns[roleIndex] || '').trim() : '';
    const allocatedRaw = allocatedIndex >= 0 ? (columns[allocatedIndex] || '').trim() : '';
    const allocatedParsed = Number(allocatedRaw);

    rows.push({
      studentName,
      studentEmail: studentEmailRaw || null,
      roleName: roleNameRaw || null,
      allocatedTickets: Number.isFinite(allocatedParsed) && allocatedParsed > 0 ? Math.floor(allocatedParsed) : 2
    });
  }

  return rows;
}

function naturalSeatSort(
  a: { sectionName: string; row: string; number: number },
  b: { sectionName: string; row: string; number: number }
): number {
  if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
  if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
  return a.number - b.number;
}

function pickComplimentarySeatIds(assignments: SeatAssignment[], quantity: number): Set<string> {
  if (quantity <= 0) return new Set();

  const ranked = [...assignments].sort((a, b) => {
    if (a.priceCents !== b.priceCents) return b.priceCents - a.priceCents;
    return naturalSeatSort(a, b);
  });

  return new Set(ranked.slice(0, quantity).map((assignment) => assignment.seatId));
}

async function buildSeatAssignmentsForQuote(params: {
  performanceId: string;
  seatIds: string[];
  ticketSelections?: Array<{ tierId: string; count: number }>;
}): Promise<{ performance: { showId: string }; assignments: SeatAssignment[] }> {
  const uniqueSeatIds = [...new Set(params.seatIds)];
  const [performance, seats] = await Promise.all([
    prisma.performance.findUnique({
      where: { id: params.performanceId },
      select: {
        id: true,
        showId: true,
        pricingTiers: {
          select: {
            id: true,
            name: true,
            priceCents: true
          }
        }
      }
    }),
    prisma.seat.findMany({
      where: {
        id: { in: uniqueSeatIds },
        performanceId: params.performanceId
      },
      select: {
        id: true,
        sectionName: true,
        row: true,
        number: true,
        price: true
      }
    })
  ]);

  if (!performance) {
    throw new HttpError(404, 'Performance not found');
  }

  if (seats.length !== uniqueSeatIds.length) {
    throw new HttpError(400, 'One or more seats are invalid for this performance');
  }

  const sortedSeats = [...seats].sort(naturalSeatSort);
  const tierMap = new Map(performance.pricingTiers.map((tier) => [tier.id, tier]));

  const expandedTiers: Array<{ name: string; priceCents: number }> = [];
  if (params.ticketSelections && params.ticketSelections.length > 0) {
    for (const selection of params.ticketSelections) {
      if (selection.count <= 0) continue;
      const tier = tierMap.get(selection.tierId);
      if (!tier) {
        throw new HttpError(400, `Invalid ticket tier: ${selection.tierId}`);
      }
      for (let i = 0; i < selection.count; i += 1) {
        expandedTiers.push({
          name: tier.name,
          priceCents: tier.priceCents
        });
      }
    }

    if (expandedTiers.length !== sortedSeats.length) {
      throw new HttpError(400, 'Ticket category counts must equal selected seat count');
    }
  }

  const assignments = sortedSeats.map((seat, index) => {
    const tier = expandedTiers[index];
    return {
      seatId: seat.id,
      sectionName: seat.sectionName,
      row: seat.row,
      number: seat.number,
      priceCents: tier?.priceCents ?? seat.price,
      ticketType: tier?.name ?? null
    };
  });

  return {
    performance: { showId: performance.showId },
    assignments
  };
}

export const studentCreditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/shows/:showId/student-credits', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { showId: string };
    const query = request.query as { q?: string };
    const q = query.q?.trim();

    try {
      const rows = await prisma.studentTicketCredit.findMany({
        where: {
          showId: params.showId,
          OR: q
            ? [
                { studentName: { contains: q, mode: 'insensitive' } },
                { studentEmail: { contains: q, mode: 'insensitive' } },
                { roleName: { contains: q, mode: 'insensitive' } },
                { verificationCode: { contains: q, mode: 'insensitive' } }
              ]
            : undefined
        },
        orderBy: [{ studentName: 'asc' }, { createdAt: 'desc' }],
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              createdAt: true
            }
          }
        }
      });

      reply.send(
        rows.map((row) => ({
          id: row.id,
          showId: row.showId,
          studentId: row.studentId,
          studentName: row.studentName,
          studentEmail: row.studentEmail,
          roleName: row.roleName,
          verificationCode: row.verificationCode,
          allocatedTickets: row.allocatedTickets,
          usedTickets: row.usedTickets,
          remainingTickets: studentCreditRemainingTickets(row),
          pendingTickets: row.pendingTickets,
          isActive: row.isActive,
          notes: row.notes,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          lastTransactionDate: row.transactions[0]?.createdAt || null
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch student credits');
    }
  });

  app.post('/api/admin/shows/:showId/student-credits', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { showId: string };
    const parsed = createStudentCreditSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const show = await tx.show.findUnique({ where: { id: params.showId }, select: { id: true } });
        if (!show) {
          throw new HttpError(404, 'Show not found');
        }

        const verificationCode = parsed.data.verificationCode
          ? normalizeStudentVerificationCode(parsed.data.verificationCode)
          : await issueUniqueStudentVerificationCode(tx);

        return tx.studentTicketCredit.create({
          data: {
            showId: params.showId,
            studentId: parsed.data.studentId,
            studentName: parsed.data.studentName.trim(),
            studentEmail: parsed.data.studentEmail?.trim().toLowerCase() || null,
            roleName: parsed.data.roleName?.trim() || null,
            verificationCode,
            allocatedTickets: parsed.data.allocatedTickets ?? 2,
            isActive: parsed.data.isActive ?? true,
            notes: parsed.data.notes?.trim() || null
          }
        });
      });

      await logAudit({
        actor: adminActor(request as AdminRequestUser),
        actorAdminId: adminActor(request as AdminRequestUser),
        action: 'STUDENT_CREDIT_CREATED',
        entityType: 'StudentTicketCredit',
        entityId: created.id,
        metadata: {
          showId: params.showId,
          studentName: created.studentName,
          allocatedTickets: created.allocatedTickets
        }
      });

      reply.status(201).send({
        id: created.id,
        verificationCode: created.verificationCode
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create student credit');
    }
  });

  app.post('/api/admin/shows/:showId/student-credits/import', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { showId: string };
    const parsed = importStudentCreditsSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const rows = parseStudentCreditCsv(parsed.data.csv);
      if (rows.length === 0) {
        throw new HttpError(400, 'CSV import contained no valid student rows');
      }

      const result = await prisma.$transaction(async (tx) => {
        const show = await tx.show.findUnique({ where: { id: params.showId }, select: { id: true } });
        if (!show) {
          throw new HttpError(404, 'Show not found');
        }

        const createdIds: string[] = [];
        for (const row of rows) {
          const verificationCode = await issueUniqueStudentVerificationCode(tx);
          const created = await tx.studentTicketCredit.create({
            data: {
              showId: params.showId,
              studentName: row.studentName,
              studentEmail: row.studentEmail,
              roleName: row.roleName,
              allocatedTickets: row.allocatedTickets,
              verificationCode,
              isActive: true
            },
            select: { id: true }
          });

          createdIds.push(created.id);
        }

        return {
          createdCount: createdIds.length,
          createdIds
        };
      });

      await logAudit({
        actor: adminActor(request as AdminRequestUser),
        actorAdminId: adminActor(request as AdminRequestUser),
        action: 'STUDENT_CREDIT_IMPORT',
        entityType: 'StudentTicketCredit',
        entityId: params.showId,
        metadata: {
          showId: params.showId,
          createdCount: result.createdCount
        }
      });

      reply.status(201).send(result);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to import student credits');
    }
  });

  app.patch('/api/admin/student-credits/:id', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = updateStudentCreditSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.studentTicketCredit.findUnique({ where: { id: params.id } });
        if (!existing) {
          throw new HttpError(404, 'Student credit record not found');
        }

        const targetAllocated = parsed.data.allocatedTickets ?? existing.allocatedTickets;
        if (targetAllocated < existing.usedTickets + existing.pendingTickets) {
          throw new HttpError(
            400,
            'Allocated ticket count cannot be lower than used + pending tickets for this student credit'
          );
        }

        const verificationCode =
          parsed.data.verificationCode === undefined
            ? undefined
            : parsed.data.verificationCode
              ? normalizeStudentVerificationCode(parsed.data.verificationCode)
              : null;

        const next = await tx.studentTicketCredit.update({
          where: { id: existing.id },
          data: {
            studentId:
              parsed.data.studentId === undefined
                ? undefined
                : parsed.data.studentId === null
                  ? null
                  : parsed.data.studentId.trim(),
            studentName: parsed.data.studentName?.trim(),
            studentEmail:
              parsed.data.studentEmail === undefined
                ? undefined
                : parsed.data.studentEmail
                  ? parsed.data.studentEmail.trim().toLowerCase()
                  : null,
            roleName:
              parsed.data.roleName === undefined
                ? undefined
                : parsed.data.roleName
                  ? parsed.data.roleName.trim()
                  : null,
            verificationCode,
            allocatedTickets: parsed.data.allocatedTickets,
            isActive: parsed.data.isActive,
            notes:
              parsed.data.notes === undefined
                ? undefined
                : parsed.data.notes
                  ? parsed.data.notes.trim()
                  : null
          }
        });

        const allocationDiff = next.allocatedTickets - existing.allocatedTickets;
        if (allocationDiff !== 0) {
          await tx.studentTicketCreditTransaction.create({
            data: {
              studentTicketCreditId: existing.id,
              quantity: Math.abs(allocationDiff),
              type:
                allocationDiff > 0
                  ? StudentCreditTransactionType.ADJUSTMENT_ADD
                  : StudentCreditTransactionType.ADJUSTMENT_REMOVE,
              verificationMethod: StudentCreditVerificationMethod.ADMIN,
              redeemedBy: adminActor(request as AdminRequestUser),
              notes: parsed.data.notes || 'Allocation updated by admin'
            }
          });
        }

        return next;
      });

      await logAudit({
        actor: adminActor(request as AdminRequestUser),
        actorAdminId: adminActor(request as AdminRequestUser),
        action: 'STUDENT_CREDIT_UPDATED',
        entityType: 'StudentTicketCredit',
        entityId: updated.id,
        metadata: parsed.data
      });

      reply.send({
        id: updated.id,
        allocatedTickets: updated.allocatedTickets,
        usedTickets: updated.usedTickets,
        remainingTickets: studentCreditRemainingTickets(updated),
        isActive: updated.isActive,
        verificationCode: updated.verificationCode
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update student credit record');
    }
  });

  app.post(
    '/api/admin/student-credits/:id/regenerate-code',
    { preHandler: app.authenticateAdmin },
    async (request, reply) => {
      const params = request.params as { id: string };

      try {
        const updated = await prisma.$transaction(async (tx) => {
          const existing = await tx.studentTicketCredit.findUnique({ where: { id: params.id }, select: { id: true } });
          if (!existing) {
            throw new HttpError(404, 'Student credit record not found');
          }

          const newCode = await issueUniqueStudentVerificationCode(tx);
          return tx.studentTicketCredit.update({
            where: { id: params.id },
            data: {
              verificationCode: newCode
            },
            select: {
              id: true,
              verificationCode: true
            }
          });
        });

        await logAudit({
          actor: adminActor(request as AdminRequestUser),
          actorAdminId: adminActor(request as AdminRequestUser),
          action: 'STUDENT_CREDIT_CODE_REGENERATED',
          entityType: 'StudentTicketCredit',
          entityId: updated.id
        });

        reply.send(updated);
      } catch (err) {
        handleRouteError(reply, err, 'Failed to regenerate verification code');
      }
    }
  );

  app.get('/api/admin/student-credits/:id/transactions', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const [credit, transactions] = await Promise.all([
        prisma.studentTicketCredit.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            studentName: true,
            allocatedTickets: true,
            usedTickets: true,
            pendingTickets: true
          }
        }),
        prisma.studentTicketCreditTransaction.findMany({
          where: { studentTicketCreditId: params.id },
          orderBy: { createdAt: 'desc' },
          include: {
            performance: {
              select: {
                id: true,
                title: true,
                startsAt: true,
                show: {
                  select: {
                    title: true
                  }
                }
              }
            },
            order: {
              select: {
                id: true,
                status: true,
                source: true,
                amountTotal: true
              }
            }
          }
        })
      ]);

      if (!credit) {
        throw new HttpError(404, 'Student credit record not found');
      }

      reply.send({
        credit: {
          id: credit.id,
          studentName: credit.studentName,
          allocatedTickets: credit.allocatedTickets,
          usedTickets: credit.usedTickets,
          pendingTickets: credit.pendingTickets,
          remainingTickets: studentCreditRemainingTickets(credit)
        },
        transactions
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch student credit transaction history');
    }
  });

  app.post('/api/admin/student-credits/:id/manual-redeem', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = manualActionSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await manualRedeemStudentCredit({
        studentTicketCreditId: params.id,
        quantity: parsed.data.quantity,
        performanceId: parsed.data.performanceId,
        notes: parsed.data.notes,
        redeemedBy: adminActor(request as AdminRequestUser)
      });

      await logAudit({
        actor: adminActor(request as AdminRequestUser),
        actorAdminId: adminActor(request as AdminRequestUser),
        action: 'STUDENT_CREDIT_MANUAL_REDEEM',
        entityType: 'StudentTicketCredit',
        entityId: updated.id,
        metadata: parsed.data
      });

      reply.send({
        id: updated.id,
        allocatedTickets: updated.allocatedTickets,
        usedTickets: updated.usedTickets,
        remainingTickets: studentCreditRemainingTickets(updated)
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to manually redeem student credits');
    }
  });

  app.post('/api/admin/student-credits/:id/manual-restore', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = manualActionSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await manualRestoreStudentCredit({
        studentTicketCreditId: params.id,
        quantity: parsed.data.quantity,
        performanceId: parsed.data.performanceId,
        notes: parsed.data.notes,
        restoredBy: adminActor(request as AdminRequestUser)
      });

      await logAudit({
        actor: adminActor(request as AdminRequestUser),
        actorAdminId: adminActor(request as AdminRequestUser),
        action: 'STUDENT_CREDIT_MANUAL_RESTORE',
        entityType: 'StudentTicketCredit',
        entityId: updated.id,
        metadata: parsed.data
      });

      reply.send({
        id: updated.id,
        allocatedTickets: updated.allocatedTickets,
        usedTickets: updated.usedTickets,
        remainingTickets: studentCreditRemainingTickets(updated)
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to manually restore student credits');
    }
  });

  app.post('/api/checkout/student-credits/validate', async (request, reply) => {
    const parsed = validateStudentCreditSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (parsed.data.verification.method !== 'code') {
      return reply.status(400).send({ error: 'School login verification is not enabled yet. Use verification code.' });
    }

    try {
      const eligibility = await getStudentCreditEligibilityByCode({
        performanceId: parsed.data.performanceId,
        verificationCode: parsed.data.verification.code || '',
        requestedSeatCount: parsed.data.seatIds.length
      });

      reply.send(eligibility);
    } catch (err) {
      handleRouteError(reply, err, 'Student credit validation failed');
    }
  });

  app.post('/api/checkout/student-credits/quote', async (request, reply) => {
    const parsed = quoteStudentCreditSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (parsed.data.verification.method !== 'code') {
      return reply.status(400).send({ error: 'School login verification is not enabled yet. Use verification code.' });
    }

    try {
      const { assignments } = await buildSeatAssignmentsForQuote({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        ticketSelections: parsed.data.ticketSelections
      });

      const eligibility = await getStudentCreditEligibilityByCode({
        performanceId: parsed.data.performanceId,
        verificationCode: parsed.data.verification.code || '',
        requestedSeatCount: assignments.length
      });

      const complimentaryQuantity = Math.min(assignments.length, eligibility.maxUsableOnCheckout);
      const complimentarySeatIds = pickComplimentarySeatIds(assignments, complimentaryQuantity);

      const seatBreakdown = assignments.map((assignment) => {
        const complimentary = complimentarySeatIds.has(assignment.seatId);
        return {
          seatId: assignment.seatId,
          sectionName: assignment.sectionName,
          row: assignment.row,
          number: assignment.number,
          ticketType: assignment.ticketType,
          basePriceCents: assignment.priceCents,
          finalPriceCents: complimentary ? 0 : assignment.priceCents,
          complimentary
        };
      });

      const baseSubtotalCents = assignments.reduce((sum, assignment) => sum + assignment.priceCents, 0);
      const complimentaryDiscountCents = seatBreakdown
        .filter((seat) => seat.complimentary)
        .reduce((sum, seat) => sum + seat.basePriceCents, 0);

      reply.send({
        ...eligibility,
        baseSubtotalCents,
        complimentaryDiscountCents,
        totalDueCents: baseSubtotalCents - complimentaryDiscountCents,
        complimentaryQuantityApplied: complimentaryQuantity,
        fullPriceQuantity: assignments.length - complimentaryQuantity,
        seatBreakdown
      });
    } catch (err) {
      handleRouteError(reply, err, 'Student credit quote failed');
    }
  });

  app.post('/api/checkout/student-credits/finalize', async (request, reply) => {
    const parsed = finalizeStudentCreditSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const order = await prisma.order.findFirst({
        where: {
          id: parsed.data.orderId,
          email: parsed.data.email.trim().toLowerCase()
        },
        select: {
          id: true,
          performanceId: true,
          source: true,
          status: true,
          studentTicketCreditId: true,
          studentCreditPendingQuantity: true,
          studentCreditVerificationMethod: true
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      if (order.status !== 'PAID') {
        throw new HttpError(400, 'Order must be paid before finalizing student credit redemption');
      }

      const finalizedQuantity = await prisma.$transaction(async (tx) => {
        const freshOrder = await tx.order.findUnique({
          where: { id: order.id },
          select: {
            id: true,
            performanceId: true,
            source: true,
            studentTicketCreditId: true,
            studentCreditPendingQuantity: true,
            studentCreditVerificationMethod: true
          }
        });

        if (!freshOrder) {
          throw new HttpError(404, 'Order not found');
        }

        return finalizeStudentCreditForOrderTx(tx, freshOrder);
      });

      reply.send({
        orderId: order.id,
        finalizedQuantity,
        finalized: finalizedQuantity > 0
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to finalize student credit redemption');
    }
  });
};
