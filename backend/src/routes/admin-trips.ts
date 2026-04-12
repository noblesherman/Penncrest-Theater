import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { logAudit } from '../lib/audit-log.js';
import { deleteUploadedObjectByKey } from '../lib/r2.js';

const createTripSchema = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  destination: z.string().trim().max(180).optional(),
  startsAt: z.string().datetime().optional(),
  dueAt: z.string().datetime(),
  defaultCostCents: z.coerce.number().int().min(0).max(2_000_000),
  allowPartialPayments: z.boolean().default(false),
  isPublished: z.boolean().default(false)
});

const updateTripSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    destination: z.string().trim().max(180).nullable().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    dueAt: z.string().datetime().optional(),
    defaultCostCents: z.coerce.number().int().min(0).max(2_000_000).optional(),
    allowPartialPayments: z.boolean().optional(),
    isPublished: z.boolean().optional(),
    isArchived: z.boolean().optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update'
  });

const tripDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  fileUrl: z.string().trim().url().max(1000),
  fileKey: z.string().trim().max(500).optional(),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.coerce.number().int().min(1).max(50 * 1024 * 1024),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional()
});

const manualRosterSchema = z.object({
  entries: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        grade: z.string().trim().max(20).optional(),
        targetAmountCents: z.coerce.number().int().min(0).max(2_000_000).optional(),
        dueAtOverride: z.string().datetime().optional()
      })
    )
    .min(1)
    .max(1000)
});

const csvImportSchema = z.object({
  csvText: z.string().min(1).max(2_000_000)
});

const enrollmentOverrideSchema = z
  .object({
    targetAmountCents: z.coerce.number().int().min(0).max(2_000_000).optional(),
    dueAtOverride: z.union([z.string().datetime(), z.null()]).optional(),
    reason: z.string().trim().min(1).max(300).optional()
  })
  .refine((value) => value.targetAmountCents !== undefined || value.dueAtOverride !== undefined, {
    message: 'Provide targetAmountCents and/or dueAtOverride'
  });

const reassignStudentSchema = z.object({
  accountId: z.string().trim().min(1).nullable().optional()
});

function parseOptionalDate(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'Invalid date value');
  }
  return parsed;
}

function csvSplitLine(line: string): string[] {
  return line.split(',').map((part) => part.trim());
}

type ParsedRosterEntry = {
  name: string;
  grade: string | null;
  targetAmountCents: number | undefined;
  dueAtOverride: Date | undefined;
};

function parseRosterCsv(csvText: string): ParsedRosterEntry[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new HttpError(400, 'CSV is empty');
  }

  const headers = csvSplitLine(lines[0]).map((field) => field.toLowerCase());
  const hasHeader = headers.includes('name');

  const indexes = {
    name: hasHeader ? headers.indexOf('name') : 0,
    grade: hasHeader ? headers.indexOf('grade') : 1,
    targetAmountCents: hasHeader
      ? Math.max(headers.indexOf('targetamountcents'), headers.indexOf('target'))
      : 2,
    dueAtOverride: hasHeader
      ? Math.max(headers.indexOf('dueatoverride'), headers.indexOf('dueat'))
      : 3
  };

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const entries: ParsedRosterEntry[] = [];

  for (const line of dataLines) {
    const parts = csvSplitLine(line);
    const name = (parts[indexes.name] || '').trim();
    if (!name) continue;

    const gradeRaw = indexes.grade >= 0 ? (parts[indexes.grade] || '').trim() : '';
    const targetRaw = indexes.targetAmountCents >= 0 ? (parts[indexes.targetAmountCents] || '').trim() : '';
    const dueRaw = indexes.dueAtOverride >= 0 ? (parts[indexes.dueAtOverride] || '').trim() : '';

    const parsedTargetAmountCents = targetRaw ? Number.parseInt(targetRaw, 10) : undefined;
    if (
      targetRaw &&
      (parsedTargetAmountCents === undefined ||
        !Number.isFinite(parsedTargetAmountCents) ||
        parsedTargetAmountCents < 0)
    ) {
      throw new HttpError(400, `Invalid target amount in CSV for ${name}`);
    }

    const dueAtOverride = dueRaw ? parseOptionalDate(dueRaw) : undefined;
    if (dueAtOverride === null) {
      throw new HttpError(400, `Invalid due date in CSV for ${name}`);
    }

    entries.push({
      name,
      grade: gradeRaw || null,
      targetAmountCents: parsedTargetAmountCents,
      dueAtOverride: dueAtOverride || undefined
    });
  }

  if (entries.length === 0) {
    throw new HttpError(400, 'CSV did not include any valid roster entries');
  }

  return entries;
}

async function findOrCreateTripStudentTx(
  tx: Prisma.TransactionClient,
  params: { name: string; grade: string | null }
): Promise<{ id: string; name: string; grade: string | null }> {
  const normalizedName = params.name.trim();
  const normalizedGrade = params.grade?.trim() || null;

  const existing = await tx.tripStudent.findFirst({
    where: {
      name: {
        equals: normalizedName,
        mode: 'insensitive'
      },
      grade: normalizedGrade,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      grade: true
    }
  });

  if (existing) {
    return existing;
  }

  return tx.tripStudent.create({
    data: {
      name: normalizedName,
      grade: normalizedGrade,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      grade: true
    }
  });
}

async function upsertTripRosterEntries(params: { tripId: string; entries: ParsedRosterEntry[] }) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({
      where: { id: params.tripId },
      select: { id: true, defaultCostCents: true }
    });

    if (!trip) {
      throw new HttpError(404, 'Trip not found');
    }

    const touchedEnrollmentIds: string[] = [];

    for (const entry of params.entries) {
      const student = await findOrCreateTripStudentTx(tx, {
        name: entry.name,
        grade: entry.grade
      });

      const targetAmountCents = entry.targetAmountCents ?? trip.defaultCostCents;

      const enrollment = await tx.tripEnrollment.upsert({
        where: {
          tripId_studentId: {
            tripId: trip.id,
            studentId: student.id
          }
        },
        update: {
          targetAmountCents,
          dueAtOverride: entry.dueAtOverride || null
        },
        create: {
          tripId: trip.id,
          studentId: student.id,
          targetAmountCents,
          dueAtOverride: entry.dueAtOverride || null
        },
        select: {
          id: true
        }
      });

      touchedEnrollmentIds.push(enrollment.id);
    }

    return {
      tripId: trip.id,
      touchedEnrollmentIds
    };
  });
}

function toCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export const adminTripRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/trips', { preHandler: app.requireAdminRole('ADMIN') }, async (_request, reply) => {
    try {
      const trips = await prisma.trip.findMany({
        include: {
          _count: {
            select: {
              enrollments: true,
              documents: true
            }
          }
        },
        orderBy: [{ isArchived: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }]
      });

      reply.send({ trips });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load trips');
    }
  });

  app.get('/api/admin/trips/:tripId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: params.tripId },
        include: {
          documents: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
          }
        }
      });

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      reply.send({ trip });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load trip');
    }
  });

  app.post('/api/admin/trips', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createTripSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await prisma.trip.create({
        data: {
          title: parsed.data.title,
          slug: parsed.data.slug,
          destination: parsed.data.destination?.trim() || null,
          startsAt: parseOptionalDate(parsed.data.startsAt) || null,
          dueAt: new Date(parsed.data.dueAt),
          defaultCostCents: parsed.data.defaultCostCents,
          allowPartialPayments: parsed.data.allowPartialPayments,
          isPublished: parsed.data.isPublished,
          isArchived: false
        }
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id,
        action: 'TRIP_CREATED',
        entityType: 'Trip',
        entityId: created.id,
        metadata: {
          slug: created.slug
        }
      });

      reply.status(201).send({ trip: created });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Trip slug already exists' });
      }
      handleRouteError(reply, err, 'Failed to create trip');
    }
  });

  app.patch('/api/admin/trips/:tripId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };
    const parsed = updateTripSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await prisma.trip.update({
        where: { id: params.tripId },
        data: {
          title: parsed.data.title,
          slug: parsed.data.slug,
          destination: parsed.data.destination?.trim() || parsed.data.destination || undefined,
          startsAt: parseOptionalDate(parsed.data.startsAt),
          dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
          defaultCostCents: parsed.data.defaultCostCents,
          allowPartialPayments: parsed.data.allowPartialPayments,
          isPublished: parsed.data.isPublished,
          isArchived: parsed.data.isArchived
        }
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id,
        action: 'TRIP_UPDATED',
        entityType: 'Trip',
        entityId: updated.id,
        metadata: parsed.data
      });

      reply.send({ trip: updated });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Trip not found' });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Trip slug already exists' });
      }
      handleRouteError(reply, err, 'Failed to update trip');
    }
  });

  app.post('/api/admin/trips/:tripId/publish', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const trip = await prisma.trip.update({
        where: { id: params.tripId },
        data: { isPublished: true, isArchived: false }
      });

      reply.send({ trip });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Trip not found' });
      }
      handleRouteError(reply, err, 'Failed to publish trip');
    }
  });

  app.post('/api/admin/trips/:tripId/archive', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const trip = await prisma.trip.update({
        where: { id: params.tripId },
        data: { isArchived: true, isPublished: false }
      });

      reply.send({ trip });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'Trip not found' });
      }
      handleRouteError(reply, err, 'Failed to archive trip');
    }
  });

  app.delete('/api/admin/trips/:tripId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const existing = await prisma.trip.findUnique({
        where: { id: params.tripId },
        include: {
          documents: {
            select: {
              id: true,
              fileKey: true
            }
          },
          _count: {
            select: {
              enrollments: true,
              documents: true
            }
          }
        }
      });
      if (!existing) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const deleted = await prisma.$transaction(async (tx) => {
        const enrollments = await tx.tripEnrollment.findMany({
          where: {
            tripId: existing.id
          },
          select: {
            id: true
          }
        });

        const enrollmentIds = enrollments.map((row) => row.id);
        const deletedPayments =
          enrollmentIds.length === 0
            ? 0
            : (
                await tx.tripPayment.deleteMany({
                  where: {
                    enrollmentId: {
                      in: enrollmentIds
                    }
                  }
                })
              ).count;

        const deletedEnrollments = (
          await tx.tripEnrollment.deleteMany({
            where: {
              tripId: existing.id
            }
          })
        ).count;

        const deletedDocuments = (
          await tx.tripDocument.deleteMany({
            where: {
              tripId: existing.id
            }
          })
        ).count;

        await tx.trip.delete({
          where: {
            id: existing.id
          }
        });

        return {
          deletedPayments,
          deletedEnrollments,
          deletedDocuments
        };
      });

      const documentKeys = existing.documents
        .map((document) => document.fileKey)
        .filter((key): key is string => Boolean(key));
      const r2DeleteResults = await Promise.allSettled(documentKeys.map((key) => deleteUploadedObjectByKey(key)));
      const failedDocumentObjectDeletes = r2DeleteResults.filter((result) => result.status === 'rejected').length;

      if (failedDocumentObjectDeletes > 0) {
        app.log.warn(
          {
            tripId: existing.id,
            failedDocumentObjectDeletes,
            documentObjectCount: documentKeys.length
          },
          'trip deleted but some document objects could not be removed from storage'
        );
      }

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id,
        action: 'TRIP_DELETED',
        entityType: 'Trip',
        entityId: existing.id,
        metadata: {
          slug: existing.slug,
          deletedEnrollments: deleted.deletedEnrollments,
          deletedPayments: deleted.deletedPayments,
          deletedDocuments: deleted.deletedDocuments,
          deletedDocumentObjects: documentKeys.length - failedDocumentObjectDeletes,
          failedDocumentObjectDeletes
        }
      });

      reply.send({
        deleted: true,
        tripId: existing.id,
        deletedEnrollments: deleted.deletedEnrollments,
        deletedPayments: deleted.deletedPayments,
        deletedDocuments: deleted.deletedDocuments,
        deletedDocumentObjects: documentKeys.length - failedDocumentObjectDeletes,
        failedDocumentObjectDeletes
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to delete trip');
    }
  });

  app.post('/api/admin/trips/:tripId/documents', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };
    const parsed = tripDocumentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: params.tripId },
        select: { id: true }
      });
      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const created = await prisma.tripDocument.create({
        data: {
          tripId: params.tripId,
          title: parsed.data.title,
          fileUrl: parsed.data.fileUrl,
          fileKey: parsed.data.fileKey,
          mimeType: parsed.data.mimeType,
          sizeBytes: parsed.data.sizeBytes,
          sortOrder: parsed.data.sortOrder || 0
        }
      });

      reply.status(201).send({ document: created });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create trip document');
    }
  });

  app.patch('/api/admin/trips/:tripId/documents/:documentId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string; documentId: string };
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(160).optional(),
        sortOrder: z.coerce.number().int().min(0).max(10000).optional()
      })
      .refine((value) => Object.values(value).some((field) => field !== undefined), {
        message: 'Provide title and/or sortOrder'
      })
      .safeParse(request.body || {});

    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await prisma.tripDocument.updateMany({
        where: {
          id: params.documentId,
          tripId: params.tripId
        },
        data: parsed.data
      });

      if (updated.count === 0) {
        return reply.status(404).send({ error: 'Trip document not found' });
      }

      const row = await prisma.tripDocument.findUnique({
        where: { id: params.documentId }
      });
      reply.send({ document: row });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update trip document');
    }
  });

  app.delete('/api/admin/trips/:tripId/documents/:documentId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string; documentId: string };

    try {
      const deleted = await prisma.tripDocument.deleteMany({
        where: {
          id: params.documentId,
          tripId: params.tripId
        }
      });

      if (deleted.count === 0) {
        return reply.status(404).send({ error: 'Trip document not found' });
      }

      reply.status(204).send();
    } catch (err) {
      handleRouteError(reply, err, 'Failed to delete trip document');
    }
  });

  app.get('/api/admin/trips/:tripId/roster', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: params.tripId },
        select: {
          id: true,
          dueAt: true
        }
      });

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const enrollments = await prisma.tripEnrollment.findMany({
        where: {
          tripId: trip.id
        },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              grade: true,
              isActive: true
            }
          },
          claimedByAccount: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        },
        orderBy: [{ student: { name: 'asc' } }]
      });

      const enrollmentIds = enrollments.map((row) => row.id);
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

      reply.send({
        roster: enrollments.map((enrollment) => {
          const paidAmountCents = paidByEnrollment.get(enrollment.id) || 0;
          const remainingAmountCents = Math.max(0, enrollment.targetAmountCents - paidAmountCents);
          return {
            id: enrollment.id,
            student: enrollment.student,
            targetAmountCents: enrollment.targetAmountCents,
            paidAmountCents,
            remainingAmountCents,
            dueAt: enrollment.dueAtOverride || trip.dueAt,
            dueAtOverride: enrollment.dueAtOverride,
            claimedByAccount: enrollment.claimedByAccount,
            claimedAt: enrollment.claimedAt,
            createdAt: enrollment.createdAt,
            updatedAt: enrollment.updatedAt
          };
        })
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load trip roster');
    }
  });

  app.post('/api/admin/trips/:tripId/roster', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };
    const parsed = manualRosterSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const entries: ParsedRosterEntry[] = parsed.data.entries.map((entry) => ({
        name: entry.name,
        grade: entry.grade?.trim() || null,
        targetAmountCents: entry.targetAmountCents,
        dueAtOverride: entry.dueAtOverride ? new Date(entry.dueAtOverride) : undefined
      }));

      const result = await upsertTripRosterEntries({
        tripId: params.tripId,
        entries
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id,
        action: 'TRIP_ROSTER_UPSERTED',
        entityType: 'Trip',
        entityId: params.tripId,
        metadata: {
          entries: entries.length,
          touchedEnrollmentIds: result.touchedEnrollmentIds.length
        }
      });

      reply.status(201).send({
        tripId: result.tripId,
        touchedEnrollmentIds: result.touchedEnrollmentIds
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to upsert trip roster');
    }
  });

  app.post('/api/admin/trips/:tripId/roster/import', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };
    const parsed = csvImportSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const entries = parseRosterCsv(parsed.data.csvText);
      const result = await upsertTripRosterEntries({
        tripId: params.tripId,
        entries
      });

      await logAudit({
        actor: request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id,
        action: 'TRIP_ROSTER_IMPORTED_CSV',
        entityType: 'Trip',
        entityId: params.tripId,
        metadata: {
          entries: entries.length,
          touchedEnrollmentIds: result.touchedEnrollmentIds.length
        }
      });

      reply.send({
        importedCount: entries.length,
        touchedEnrollmentIds: result.touchedEnrollmentIds
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to import trip roster CSV');
    }
  });

  app.patch('/api/admin/trips/enrollments/:enrollmentId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { enrollmentId: string };
    const parsed = enrollmentOverrideSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.tripEnrollment.findUnique({
          where: { id: params.enrollmentId },
          select: {
            id: true,
            targetAmountCents: true,
            dueAtOverride: true
          }
        });

        if (!existing) {
          throw new HttpError(404, 'Enrollment not found');
        }

        const nextDueAt = parseOptionalDate(parsed.data.dueAtOverride);

        const enrollment = await tx.tripEnrollment.update({
          where: { id: existing.id },
          data: {
            ...(parsed.data.targetAmountCents !== undefined
              ? {
                  targetAmountCents: parsed.data.targetAmountCents
                }
              : {}),
            ...(parsed.data.dueAtOverride !== undefined
              ? {
                  dueAtOverride: nextDueAt
                }
              : {})
          }
        });

        if (parsed.data.targetAmountCents !== undefined && parsed.data.targetAmountCents !== existing.targetAmountCents) {
          await tx.tripBalanceAdjustment.create({
            data: {
              enrollmentId: enrollment.id,
              previousTargetAmountCents: existing.targetAmountCents,
              newTargetAmountCents: parsed.data.targetAmountCents,
              reason: parsed.data.reason || 'Admin target amount override',
              actorAdminId: request.adminUser?.id
            }
          });
        }

        return enrollment;
      });

      reply.send({ enrollment: updated });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update enrollment override');
    }
  });

  app.post('/api/admin/trips/students/:studentId/reassign', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { studentId: string };
    const parsed = reassignStudentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const student = await prisma.tripStudent.findUnique({
        where: { id: params.studentId },
        select: { id: true, name: true, grade: true }
      });
      if (!student) {
        return reply.status(404).send({ error: 'Student not found' });
      }

      const accountId = parsed.data.accountId || null;
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        if (!accountId) {
          await tx.tripAccount.updateMany({
            where: { studentId: student.id },
            data: { studentId: null }
          });
          await tx.tripEnrollment.updateMany({
            where: { studentId: student.id },
            data: {
              claimedByAccountId: null,
              claimedAt: null
            }
          });
          return;
        }

        const targetAccount = await tx.tripAccount.findUnique({
          where: { id: accountId },
          select: {
            id: true,
            isActive: true,
            studentId: true
          }
        });
        if (!targetAccount || !targetAccount.isActive) {
          throw new HttpError(404, 'Target account not found');
        }
        if (targetAccount.studentId && targetAccount.studentId !== student.id) {
          throw new HttpError(409, 'Target account is already assigned to a different student');
        }

        await tx.tripAccount.updateMany({
          where: {
            studentId: student.id,
            id: {
              not: targetAccount.id
            }
          },
          data: {
            studentId: null
          }
        });

        await tx.tripAccount.update({
          where: {
            id: targetAccount.id
          },
          data: {
            studentId: student.id
          }
        });

        await tx.tripEnrollment.updateMany({
          where: {
            studentId: student.id
          },
          data: {
            claimedByAccountId: targetAccount.id,
            claimedAt: now
          }
        });
      });

      const reassignedTo = accountId
        ? await prisma.tripAccount.findUnique({
            where: { id: accountId },
            select: {
              id: true,
              email: true,
              name: true,
              studentId: true
            }
          })
        : null;

      reply.send({
        student,
        reassignedTo
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Student is already assigned to another account' });
      }
      handleRouteError(reply, err, 'Failed to reassign student');
    }
  });

  app.get('/api/admin/trips/:tripId/ledger', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: params.tripId },
        select: { id: true, title: true, slug: true, dueAt: true }
      });
      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const rows = await prisma.tripPayment.findMany({
        where: {
          enrollment: {
            tripId: trip.id
          }
        },
        include: {
          account: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          enrollment: {
            include: {
              student: {
                select: {
                  id: true,
                  name: true,
                  grade: true
                }
              }
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }]
      });

      const enrollments = await prisma.tripEnrollment.findMany({
        where: {
          tripId: trip.id
        },
        select: {
          targetAmountCents: true
        }
      });

      const targetAmountCents = enrollments.reduce((sum, row) => sum + row.targetAmountCents, 0);
      const collectedAmountCents = rows
        .filter((row) => row.status === 'SUCCEEDED')
        .reduce((sum, row) => sum + row.amountCents, 0);
      const pendingAmountCents = rows
        .filter((row) => row.status === 'PENDING')
        .reduce((sum, row) => sum + row.amountCents, 0);

      reply.send({
        summary: {
          targetAmountCents,
          collectedAmountCents,
          pendingAmountCents,
          remainingAmountCents: Math.max(0, targetAmountCents - collectedAmountCents)
        },
        payments: rows.map((row) => ({
          id: row.id,
          enrollmentId: row.enrollmentId,
          accountId: row.accountId,
          accountEmail: row.account.email,
          accountName: row.account.name,
          studentId: row.enrollment.student.id,
          studentName: row.enrollment.student.name,
          studentGrade: row.enrollment.student.grade,
          amountCents: row.amountCents,
          currency: row.currency,
          status: row.status,
          paidAt: row.paidAt,
          createdAt: row.createdAt,
          stripeCheckoutSessionId: row.stripeCheckoutSessionId,
          stripePaymentIntentId: row.stripePaymentIntentId
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load trip ledger');
    }
  });

  app.get('/api/admin/trips/:tripId/ledger/export', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { tripId: string };

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: params.tripId },
        select: { id: true, slug: true }
      });
      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const rows = await prisma.tripPayment.findMany({
        where: {
          enrollment: {
            tripId: trip.id
          }
        },
        include: {
          account: {
            select: {
              email: true,
              name: true
            }
          },
          enrollment: {
            include: {
              student: {
                select: {
                  name: true,
                  grade: true
                }
              }
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }]
      });

      const header = [
        'paymentId',
        'studentName',
        'studentGrade',
        'accountEmail',
        'accountName',
        'amountCents',
        'currency',
        'status',
        'paidAt',
        'createdAt',
        'stripePaymentIntentId',
        'stripeCheckoutSessionId'
      ];

      const csvRows = [
        header.join(','),
        ...rows.map((row) =>
          [
            row.id,
            row.enrollment.student.name,
            row.enrollment.student.grade,
            row.account.email,
            row.account.name,
            row.amountCents,
            row.currency,
            row.status,
            row.paidAt?.toISOString() || null,
            row.createdAt.toISOString(),
            row.stripePaymentIntentId,
            row.stripeCheckoutSessionId
          ]
            .map((cell) => toCsvCell(cell))
            .join(',')
        )
      ];

      const csv = `${csvRows.join('\n')}\n`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="trip-ledger-${trip.slug}.csv"`)
        .send(csv);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to export trip ledger');
    }
  });
};
