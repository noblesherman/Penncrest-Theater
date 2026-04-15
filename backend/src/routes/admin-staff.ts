import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { env } from '../lib/env.js';
import { generateRedeemCode, hashRedeemCode, normalizeRedeemCode } from '../lib/staff-code.js';
import { logAudit } from '../lib/audit-log.js';

const generateCodesSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
  expiresInMinutes: z.number().int().min(5).max(60 * 24 * 30).optional()
});

const revokeUserSchema = z.object({
  reason: z.string().max(200).optional()
});

const createTeacherCompPromoCodeSchema = z.object({
  code: z.string().min(4).max(64),
  expiresAt: z.union([z.string().datetime(), z.null()]).optional()
});

const revokeTeacherCompPromoCodeSchema = z.object({
  reason: z.string().max(200).optional()
});

export const adminStaffRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/admin/staff/users', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const query = request.query as { verified?: string; q?: string; limit?: string };

    const verified = query.verified === undefined ? undefined : query.verified === 'true';
    const q = query.q?.trim().toLowerCase();
    const limit = Math.min(Math.max(Number(query.limit || '100'), 1), 500);

    try {
      const users = await prisma.user.findMany({
        where: {
          verifiedStaff: verified,
          OR: q
            ? [
                { email: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } }
              ]
            : undefined
        },
        orderBy: [{ verifiedStaff: 'desc' }, { staffVerifiedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit
      });

      reply.send(users);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch staff users');
    }
  });

  app.post('/api/admin/staff/users/:userId/revoke', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { userId: string };
    const parsed = revokeUserSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.user.findUnique({ where: { id: params.userId } });
      if (!existing) {
        throw new HttpError(404, 'User not found');
      }

      const updated = await prisma.user.update({
        where: { id: params.userId },
        data: {
          verifiedStaff: false,
          staffVerifiedAt: null,
          staffVerifyMethod: null
        }
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: adminActor(request),
        action: 'STAFF_VERIFICATION_REVOKED',
        entityType: 'User',
        entityId: updated.id,
        metadata: {
          reason: parsed.data.reason || null,
          previousVerifyMethod: existing.staffVerifyMethod
        }
      });

      reply.send({
        user: {
          id: updated.id,
          email: updated.email,
          verifiedStaff: updated.verifiedStaff,
          staffVerifyMethod: updated.staffVerifyMethod,
          staffVerifiedAt: updated.staffVerifiedAt
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to revoke staff verification');
    }
  });

  app.post('/api/admin/staff/redeem-codes', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = generateCodesSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const count = parsed.data.count ?? 1;
    const ttlMinutes = parsed.data.expiresInMinutes ?? env.STAFF_REDEEM_CODE_TTL_MINUTES;
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : new Date(Date.now() + ttlMinutes * 60 * 1000);

    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return reply.status(400).send({ error: 'expiresAt must be a future date' });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const issued: Array<{ id: string; code: string; expiresAt: Date }> = [];

        for (let i = 0; i < count; i += 1) {
          const code = generateRedeemCode(12);
          const row = await tx.staffRedeemCode.create({
            data: {
              codeHash: hashRedeemCode(code),
              createdByAdminId: adminActor(request),
              expiresAt
            }
          });

          issued.push({ id: row.id, code, expiresAt: row.expiresAt });
        }

        return issued;
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: adminActor(request),
        action: 'STAFF_REDEEM_CODES_CREATED',
        entityType: 'StaffRedeemCode',
        entityId: created[0]?.id || 'batch',
        metadata: {
          count,
          expiresAt
        }
      });

      reply.status(201).send({
        codes: created
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to generate redeem codes');
    }
  });

  app.get('/api/admin/staff/redeem-codes', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const query = request.query as {
      status?: 'active' | 'used' | 'expired';
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(Number(query.page || '1'), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize || '50'), 1), 200);
    const now = new Date();

    const where =
      query.status === 'active'
        ? { usedAt: null, expiresAt: { gt: now } }
        : query.status === 'used'
          ? { usedAt: { not: null } }
          : query.status === 'expired'
            ? { usedAt: null, expiresAt: { lte: now } }
            : {};

    try {
      const [rows, total] = await Promise.all([
        prisma.staffRedeemCode.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            usedByUser: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }),
        prisma.staffRedeemCode.count({ where })
      ]);

      reply.send({ page, pageSize, total, rows });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch redeem codes');
    }
  });

  app.post('/api/admin/staff/teacher-comp-promo-codes', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createTeacherCompPromoCodeSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const normalizedCode = normalizeRedeemCode(parsed.data.code);
    if (normalizedCode.length < 4) {
      return reply.status(400).send({ error: 'Code must include at least 4 letters or numbers' });
    }

    const expiresAtRaw = parsed.data.expiresAt === undefined ? undefined : parsed.data.expiresAt;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
      return reply.status(400).send({ error: 'expiresAt must be in the future' });
    }

    const codeHash = hashRedeemCode(normalizedCode);

    try {
      const existing = await prisma.teacherCompPromoCode.findUnique({
        where: { codeHash },
        select: { id: true }
      });
      if (existing) {
        throw new HttpError(409, 'Teacher promo code already exists');
      }

      const created = await prisma.teacherCompPromoCode.create({
        data: {
          codeHash,
          code: normalizedCode,
          createdByAdminId: adminActor(request),
          expiresAt: expiresAt || null
        }
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: adminActor(request),
        action: 'TEACHER_COMP_PROMO_CODE_CREATED',
        entityType: 'TeacherCompPromoCode',
        entityId: created.id,
        metadata: {
          expiresAt: created.expiresAt,
          normalizedCodeLength: normalizedCode.length
        }
      });

      reply.status(201).send({
        promoCode: {
          id: created.id,
          code: created.code,
          createdByAdminId: created.createdByAdminId,
          active: created.active,
          expiresAt: created.expiresAt,
          createdAt: created.createdAt
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to create teacher comp promo code');
    }
  });

  app.get('/api/admin/staff/teacher-comp-promo-codes', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const querySchema = z.object({
      status: z.enum(['active', 'inactive', 'all']).default('active'),
      page: z.string().optional(),
      pageSize: z.string().optional()
    });
    const parsedQuery = querySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }

    const query = parsedQuery.data;
    const page = Math.max(Number(query.page || '1'), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize || '50'), 1), 200);
    const now = new Date();

    const where =
      query.status === 'active'
        ? {
            active: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
          }
        : query.status === 'inactive'
          ? {
              OR: [{ active: false }, { expiresAt: { lte: now } }]
            }
          : {};

    try {
      const [rows, total] = await Promise.all([
        prisma.teacherCompPromoCode.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize
        }),
        prisma.teacherCompPromoCode.count({ where })
      ]);

      reply.send({
        page,
        pageSize,
        total,
        rows: rows.map((row) => ({
          id: row.id,
          code: row.code,
          createdByAdminId: row.createdByAdminId,
          active: row.active,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          isExpired: Boolean(row.expiresAt && row.expiresAt <= now)
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch teacher comp promo codes');
    }
  });

  app.post(
    '/api/admin/staff/teacher-comp-promo-codes/:codeId/revoke',
    { preHandler: app.requireAdminRole('ADMIN') },
    async (request, reply) => {
      const params = request.params as { codeId: string };
      const parsed = revokeTeacherCompPromoCodeSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const existing = await prisma.teacherCompPromoCode.findUnique({ where: { id: params.codeId } });
        if (!existing) {
          throw new HttpError(404, 'Teacher promo code not found');
        }

        const updated = await prisma.teacherCompPromoCode.update({
          where: { id: params.codeId },
          data: {
            active: false
          }
        });

        await logAudit({
          actor: adminActor(request),
          actorAdminId: adminActor(request),
          action: 'TEACHER_COMP_PROMO_CODE_REVOKED',
          entityType: 'TeacherCompPromoCode',
          entityId: updated.id,
          metadata: {
            reason: parsed.data.reason || null,
            wasActive: existing.active
          }
        });

        reply.send({
          promoCode: {
            id: updated.id,
            active: updated.active,
            expiresAt: updated.expiresAt,
            createdAt: updated.createdAt
          }
        });
      } catch (err) {
        handleRouteError(reply, err, 'We hit a small backstage snag while trying to revoke teacher comp promo code');
      }
    }
  );

  app.get('/api/admin/staff/redemptions', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const querySchema = z.object({
      performanceId: z.string().optional(),
      userId: z.string().optional(),
      page: z.string().optional(),
      pageSize: z.string().optional(),
      scope: z.enum(['active', 'archived', 'all']).default('active')
    });
    const parsedQuery = querySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }
    const query = parsedQuery.data;

    const page = Math.max(Number(query.page || '1'), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize || '50'), 1), 200);

    try {
      const where = {
        performanceId: query.performanceId || undefined,
        userId: query.userId || undefined,
        ...(query.scope !== 'all'
          ? {
              performance: {
                isArchived: query.scope === 'archived'
              }
            }
          : {})
      };

      const [rows, total] = await Promise.all([
        prisma.staffCompRedemption.findMany({
          where,
          orderBy: { redeemedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                staffVerifyMethod: true,
                verifiedStaff: true
              }
            },
            performance: {
              select: {
                id: true,
                title: true,
                startsAt: true,
                show: {
                  select: { title: true }
                }
              }
            },
            ticket: {
              select: {
                id: true,
                publicId: true,
                seatId: true,
                status: true,
                priceCents: true,
                orderId: true,
                seat: {
                  select: {
                    sectionName: true,
                    row: true,
                    number: true
                  }
                }
              }
            }
          }
        }),
        prisma.staffCompRedemption.count({ where })
      ]);

      reply.send({
        page,
        pageSize,
        total,
        rows: rows.map((row) => ({
          id: row.id,
          redeemedAt: row.redeemedAt,
          user: row.user,
          performance: {
            id: row.performance.id,
            title: row.performance.title || row.performance.show.title,
            startsAt: row.performance.startsAt
          },
          ticket: row.ticket
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch staff comp redemptions');
    }
  });
};
