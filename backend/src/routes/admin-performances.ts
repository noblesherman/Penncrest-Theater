import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { logAudit } from '../lib/audit-log.js';
import { getPenncrestSeatTemplate } from '../lib/penncrest-seating.js';
import { normalizeStudentVerificationCode } from '../services/student-ticket-credit-service.js';
import { isImageDataUrl } from '../lib/image-data-url.js';
import { isR2Configured, uploadImageFromDataUrl } from '../lib/r2.js';
import { backfillLegacyShowAndCastImagesToR2 } from '../lib/legacy-image-backfill.js';

const tierSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().positive()
});

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const imageSourceSchema = z
  .string()
  .max(2_000_000)
  .refine((value) => isHttpUrl(value) || isImageDataUrl(value), {
    message: 'Image must be an image URL or image data URL'
  });

const castMemberSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    photoUrl: imageSourceSchema.optional(),
    schoolEmail: z.string().trim().email().max(160).optional(),
    gradeLevel: z.number().int().min(9).max(12).optional(),
    bio: z.string().trim().max(2400).optional()
  });

const performanceScheduleSchema = z.object({
  title: z.string().min(1).optional(),
  startsAt: z.string().datetime(),
  onlineSalesStartsAt: z.string().datetime().nullable().optional(),
  salesCutoffAt: z.string().datetime().nullable().optional()
});

const createPerformanceSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  posterUrl: imageSourceSchema.optional(),
  type: z.string().optional(),
  year: z.number().int().optional(),
  accentColor: z.string().optional(),
  startsAt: z.string().datetime().optional(),
  onlineSalesStartsAt: z.string().datetime().nullable().optional(),
  salesCutoffAt: z.string().datetime().nullable().optional(),
  isPublished: z.boolean().optional(),
  performances: z.array(performanceScheduleSchema).min(1).optional(),
  staffCompsEnabled: z.boolean().optional(),
  staffCompLimitPerUser: z.number().int().min(1).max(1).optional(),
  staffTicketLimit: z.number().int().min(1).max(10).optional(),
  studentCompTicketsEnabled: z.boolean().optional(),
  familyFreeTicketEnabled: z.boolean().optional(),
  seatSelectionEnabled: z.boolean().optional(),
  venue: z.string().min(1),
  notes: z.string().optional(),
  pricingTiers: z.array(tierSchema).min(1),
  castMembers: z.array(castMemberSchema).max(80).optional(),
  pushCastToStudentComps: z.boolean().optional(),
  isFundraiser: z.boolean().optional()
});

const updatePerformanceSchema = createPerformanceSchema.partial();
const listPerformanceQuerySchema = z.object({
  scope: z.enum(['active', 'archived', 'all']).default('active'),
  kind: z.enum(['standard', 'fundraise', 'all']).default('standard')
});
const deletePerformanceQuerySchema = z.object({
  force: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
});

function buildDefaultSeats(performanceId: string): Array<{
  performanceId: string;
  row: string;
  number: number;
  sectionName: string;
  x: number;
  y: number;
  price: number;
  isAccessible: boolean;
  isCompanion: boolean;
}> {
  const seats: Array<{
    performanceId: string;
    row: string;
    number: number;
    sectionName: string;
    x: number;
    y: number;
    price: number;
    isAccessible: boolean;
    isCompanion: boolean;
  }> = [];

  getPenncrestSeatTemplate().forEach((seat) => {
    const premiumRow = ['A', 'B', 'C', 'D'].includes(seat.row);
    seats.push({
      performanceId,
      row: seat.row,
      number: seat.number,
      sectionName: seat.sectionName,
      x: seat.x,
      y: seat.y,
      price: premiumRow ? 2200 : 1800,
      isAccessible: seat.isAccessible,
      isCompanion: false
    });
  });

  return seats;
}

function buildStudentCodeFromName(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (tokens.length === 0) return '';

  const firstInitial = tokens[0][0] || '';
  const lastName = tokens[tokens.length - 1] || '';
  return normalizeStudentVerificationCode(`${firstInitial}${lastName}`);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

type PerformanceImagePayload = {
  title?: string;
  posterUrl?: string;
  castMembers?: Array<{
    name: string;
    photoUrl?: string;
  }>;
};

function normalizeImageSourceValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasPerformanceImageDataUrls(payload: PerformanceImagePayload): boolean {
  const posterUrl = normalizeImageSourceValue(payload.posterUrl);
  if (posterUrl && isImageDataUrl(posterUrl)) {
    return true;
  }

  if (!payload.castMembers || payload.castMembers.length === 0) {
    return false;
  }

  return payload.castMembers.some((castMember) => {
    const photoUrl = normalizeImageSourceValue(castMember.photoUrl);
    return Boolean(photoUrl && isImageDataUrl(photoUrl));
  });
}

function buildImageFilenameBase(raw: string | undefined, fallback: string): string {
  const value = (raw || '').trim();
  if (!value) return fallback;

  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return normalized || fallback;
}

async function convertPerformanceImageDataUrlsToR2<T extends PerformanceImagePayload>(payload: T): Promise<T> {
  const convertedBySource = new Map<string, string>();

  const convertDataUrl = async (dataUrl: string, scope: string, filenameBase: string): Promise<string> => {
    const cached = convertedBySource.get(dataUrl);
    if (cached) {
      return cached;
    }

    const uploaded = await uploadImageFromDataUrl({
      dataUrl,
      scope,
      filenameBase
    });

    convertedBySource.set(dataUrl, uploaded.url);
    return uploaded.url;
  };

  const nextPayload = { ...payload } as T;

  const posterUrl = normalizeImageSourceValue(payload.posterUrl);
  if (posterUrl && isImageDataUrl(posterUrl)) {
    (nextPayload as PerformanceImagePayload).posterUrl = await convertDataUrl(
      posterUrl,
      'show-posters',
      buildImageFilenameBase(payload.title, 'show-poster')
    );
  }

  if (payload.castMembers && payload.castMembers.length > 0) {
    const convertedCastMembers = await Promise.all(
      payload.castMembers.map(async (castMember, index) => {
        const photoUrl = normalizeImageSourceValue(castMember.photoUrl);
        if (!photoUrl || !isImageDataUrl(photoUrl)) {
          return castMember;
        }

        const convertedPhotoUrl = await convertDataUrl(
          photoUrl,
          'cast-photos',
          buildImageFilenameBase(castMember.name, `cast-member-${index + 1}`)
        );

        return {
          ...castMember,
          photoUrl: convertedPhotoUrl
        };
      })
    );

    (nextPayload as PerformanceImagePayload).castMembers = convertedCastMembers as any;
  }

  return nextPayload;
}

async function syncCastMembersToStudentCompsTx(
  tx: Prisma.TransactionClient,
  showId: string,
  castMembers: Array<{ name: string; role: string }>
): Promise<{ created: number; updated: number; skipped: number }> {
  const normalizedCast = castMembers
    .map((member) => ({
      name: member.name.trim(),
      role: member.role.trim()
    }))
    .filter((member) => member.name && member.role);

  if (normalizedCast.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const existingCredits = await tx.studentTicketCredit.findMany({
    where: { showId },
    select: {
      id: true,
      studentName: true,
      studentEmail: true,
      roleName: true
    }
  });

  const existingByCode = new Map<string, (typeof existingCredits)[number]>();
  const existingByName = new Map<string, (typeof existingCredits)[number]>();
  existingCredits.forEach((credit) => {
    const normalizedName = credit.studentName.trim().toLowerCase();
    if (normalizedName && !existingByName.has(normalizedName)) {
      existingByName.set(normalizedName, credit);
    }

    if (!credit.studentEmail) return;
    const normalizedCode = normalizeStudentVerificationCode(credit.studentEmail);
    if (!normalizedCode) return;
    if (!existingByCode.has(normalizedCode)) {
      existingByCode.set(normalizedCode, credit);
    }
  });

  const assignedCodes = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const member of normalizedCast) {
    const normalizedMemberName = member.name.trim().toLowerCase();
    const existingByMemberName = existingByName.get(normalizedMemberName);
    let candidateCode = existingByMemberName?.studentEmail
      ? normalizeStudentVerificationCode(existingByMemberName.studentEmail)
      : buildStudentCodeFromName(member.name);

    if (!candidateCode) {
      skipped += 1;
      continue;
    }

    let suffix = 2;
    while (true) {
      const codeOwner = existingByCode.get(candidateCode);
      const ownedBySameName =
        codeOwner && codeOwner.studentName.trim().toLowerCase() === normalizedMemberName;
      if (!assignedCodes.has(candidateCode) && (!codeOwner || ownedBySameName)) {
        break;
      }
      candidateCode = `${buildStudentCodeFromName(member.name)}${suffix}`;
      suffix += 1;
    }

    const existingCredit = existingByCode.get(candidateCode);
    if (existingCredit) {
      await tx.studentTicketCredit.update({
        where: { id: existingCredit.id },
        data: {
          studentName: member.name,
          roleName: member.role
        }
      });
      updated += 1;
    } else {
      const createdCredit = await tx.studentTicketCredit.create({
        data: {
          showId,
          studentName: member.name,
          studentEmail: candidateCode,
          roleName: member.role,
          allocatedTickets: 2,
          isActive: true
        },
        select: {
          id: true,
          studentName: true,
          studentEmail: true,
          roleName: true
        }
      });
      existingByCode.set(candidateCode, createdCredit);
      created += 1;
    }

    assignedCodes.add(candidateCode);
  }

  return { created, updated, skipped };
}

export const adminPerformanceRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/admin/performances', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = listPerformanceQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const where: Prisma.PerformanceWhereInput = {};
    if (parsed.data.scope !== 'all') {
      where.isArchived = parsed.data.scope === 'archived';
    }
    if (parsed.data.kind !== 'all') {
      where.isFundraiser = parsed.data.kind === 'fundraise';
    }

    try {
      const performances = await prisma.performance.findMany({
        where,
        orderBy: [{ isArchived: 'asc' }, { startsAt: 'desc' }],
        include: {
          show: {
            include: {
              castMembers: {
                orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
              }
            }
          },
          pricingTiers: true,
          seats: true,
          orders: {
            select: {
              status: true,
              amountTotal: true
            }
          }
        }
      });

      await backfillLegacyShowAndCastImagesToR2(performances.map((performance) => performance.show));

      reply.send(
        performances.map((performance) => ({
          id: performance.id,
          title: performance.title || performance.show.title,
          showId: performance.show.id,
          showTitle: performance.show.title,
          showDescription: performance.show.description,
          showPosterUrl: performance.show.posterUrl,
          showType: performance.show.type,
          showYear: performance.show.year,
          showAccentColor: performance.show.accentColor,
          startsAt: performance.startsAt,
          onlineSalesStartsAt: performance.onlineSalesStartsAt,
          salesCutoffAt: performance.salesCutoffAt,
          isPublished: performance.isPublished,
          isArchived: performance.isArchived,
          isFundraiser: performance.isFundraiser,
          archivedAt: performance.archivedAt,
          staffCompsEnabled: performance.staffCompsEnabled,
          staffCompLimitPerUser: performance.staffCompLimitPerUser,
          staffTicketLimit: performance.staffTicketLimit,
          studentCompTicketsEnabled: performance.familyFreeTicketEnabled,
          seatSelectionEnabled: performance.seatSelectionEnabled,
          venue: performance.venue,
          notes: performance.notes,
          seatsTotal: performance.seats.length,
          seatsSold: performance.seats.filter((seat) => seat.status === 'SOLD').length,
          totalOrders: performance.orders.length,
          paidOrders: performance.orders.filter((order) => order.status === 'PAID').length,
          paidRevenueCents: performance.orders
            .filter((order) => order.status === 'PAID')
            .reduce((sum, order) => sum + order.amountTotal, 0),
          pricingTiers: performance.pricingTiers,
          castMembers: performance.show.castMembers.map((castMember) => ({
            id: castMember.id,
            name: castMember.name,
            role: castMember.role,
            photoUrl: castMember.photoUrl,
            schoolEmail: castMember.schoolEmail,
            gradeLevel: castMember.gradeLevel,
            bio: castMember.bio
          }))
        }))
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2022') {
        if (parsed.data.kind === 'fundraise') {
          reply.send([]);
          return;
        }

        try {
          const legacyWhere: Prisma.PerformanceWhereInput = {};
          if (parsed.data.scope !== 'all') {
            legacyWhere.isArchived = parsed.data.scope === 'archived';
          }

          const legacyPerformances = await prisma.performance.findMany({
            where: legacyWhere,
            orderBy: [{ isArchived: 'asc' }, { startsAt: 'desc' }],
            select: {
              id: true,
              showId: true,
              title: true,
              startsAt: true,
              salesCutoffAt: true,
              isArchived: true,
              archivedAt: true,
              staffCompsEnabled: true,
              staffCompLimitPerUser: true,
              staffTicketLimit: true,
              familyFreeTicketEnabled: true,
              venue: true,
              notes: true,
              show: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  posterUrl: true,
                  type: true,
                  year: true,
                  accentColor: true,
                  castMembers: {
                    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                    select: {
                      id: true,
                      name: true,
                      role: true,
                      photoUrl: true,
                      schoolEmail: true,
                      gradeLevel: true,
                      bio: true
                    }
                  }
                }
              },
              pricingTiers: true,
              seats: {
                select: {
                  status: true
                }
              },
              orders: {
                select: {
                  status: true,
                  amountTotal: true
                }
              }
            }
          });

          await backfillLegacyShowAndCastImagesToR2(legacyPerformances.map((performance) => performance.show));

          reply.send(
            legacyPerformances.map((performance) => ({
              id: performance.id,
              title: performance.title || performance.show.title,
              showId: performance.show.id,
              showTitle: performance.show.title,
              showDescription: performance.show.description,
              showPosterUrl: performance.show.posterUrl,
              showType: performance.show.type,
              showYear: performance.show.year,
              showAccentColor: performance.show.accentColor,
              startsAt: performance.startsAt,
              onlineSalesStartsAt: null,
              salesCutoffAt: performance.salesCutoffAt,
              isPublished: true,
              isArchived: performance.isArchived,
              isFundraiser: false,
              archivedAt: performance.archivedAt,
              staffCompsEnabled: performance.staffCompsEnabled,
              staffCompLimitPerUser: performance.staffCompLimitPerUser,
              staffTicketLimit: performance.staffTicketLimit,
              studentCompTicketsEnabled: performance.familyFreeTicketEnabled,
              seatSelectionEnabled: true,
              venue: performance.venue,
              notes: performance.notes,
              seatsTotal: performance.seats.length,
              seatsSold: performance.seats.filter((seat) => seat.status === 'SOLD').length,
              totalOrders: performance.orders.length,
              paidOrders: performance.orders.filter((order) => order.status === 'PAID').length,
              paidRevenueCents: performance.orders
                .filter((order) => order.status === 'PAID')
                .reduce((sum, order) => sum + order.amountTotal, 0),
              pricingTiers: performance.pricingTiers,
              castMembers: performance.show.castMembers.map((castMember) => ({
                id: castMember.id,
                name: castMember.name,
                role: castMember.role,
                photoUrl: castMember.photoUrl,
                schoolEmail: castMember.schoolEmail,
                gradeLevel: castMember.gradeLevel,
                bio: castMember.bio
              }))
            }))
          );
          return;
        } catch (legacyErr) {
          handleRouteError(reply, legacyErr, 'Failed to fetch performances');
          return;
        }
      }

      handleRouteError(reply, err, 'Failed to fetch performances');
    }
  });

  app.post('/api/admin/performances', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createPerformanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const scheduleEntries =
      parsed.data.performances && parsed.data.performances.length > 0
        ? parsed.data.performances
        : parsed.data.startsAt
          ? [
              {
                title: parsed.data.title,
                startsAt: parsed.data.startsAt,
                onlineSalesStartsAt: parsed.data.onlineSalesStartsAt ?? null,
                salesCutoffAt: parsed.data.salesCutoffAt ?? null
              }
            ]
          : [];
    if (scheduleEntries.length === 0) {
      return reply.status(400).send({ error: 'Provide at least one performance schedule entry.' });
    }
    const studentCompTicketsEnabled =
      parsed.data.studentCompTicketsEnabled ?? parsed.data.familyFreeTicketEnabled ?? false;

    try {
      const hasImageDataUrls = hasPerformanceImageDataUrls(parsed.data);
      if (hasImageDataUrls && !isR2Configured()) {
        return reply.status(503).send({ error: 'Image uploads are unavailable because R2/CDN is not configured.' });
      }

      const payload = hasImageDataUrls
        ? await convertPerformanceImageDataUrlsToR2(parsed.data)
        : parsed.data;

      const created = await prisma.$transaction(async (tx) => {
        const show = await tx.show.create({
          data: {
            title: payload.title,
            description: payload.description,
            posterUrl: payload.posterUrl,
            type: payload.type,
            year: payload.year,
            accentColor: payload.accentColor
          }
        });

        const performanceIds: string[] = [];
        for (const scheduleEntry of scheduleEntries) {
          const performance = await tx.performance.create({
            data: {
              showId: show.id,
              title: scheduleEntry.title || payload.title,
              startsAt: new Date(scheduleEntry.startsAt),
              onlineSalesStartsAt: scheduleEntry.onlineSalesStartsAt
                ? new Date(scheduleEntry.onlineSalesStartsAt)
                : payload.onlineSalesStartsAt
                  ? new Date(payload.onlineSalesStartsAt)
                  : null,
              salesCutoffAt: scheduleEntry.salesCutoffAt ? new Date(scheduleEntry.salesCutoffAt) : null,
              isPublished: payload.isPublished ?? true,
              isFundraiser: payload.isFundraiser ?? false,
              staffCompsEnabled: payload.staffCompsEnabled ?? true,
              staffCompLimitPerUser: payload.staffCompLimitPerUser ?? 1,
              staffTicketLimit: payload.staffTicketLimit ?? 2,
              familyFreeTicketEnabled: studentCompTicketsEnabled,
              seatSelectionEnabled: payload.seatSelectionEnabled ?? true,
              venue: payload.venue,
              notes: payload.notes
            }
          });
          performanceIds.push(performance.id);

          await tx.pricingTier.createMany({
            data: payload.pricingTiers.map((tier) => ({
              performanceId: performance.id,
              name: tier.name,
              priceCents: tier.priceCents
            }))
          });

          await tx.seat.createMany({
            data: buildDefaultSeats(performance.id)
          });
        }

        if (payload.castMembers && payload.castMembers.length > 0) {
          await tx.castMember.createMany({
            data: payload.castMembers.map((castMember, position) => ({
              showId: show.id,
              name: castMember.name,
              role: castMember.role,
              photoUrl: castMember.photoUrl || null,
              schoolEmail: castMember.schoolEmail ? castMember.schoolEmail.trim().toLowerCase() : null,
              gradeLevel: castMember.gradeLevel ?? null,
              bio: castMember.bio?.trim() || null,
              position
            }))
          });
        }

        let studentCompSync: { created: number; updated: number; skipped: number } | null = null;
        if (payload.pushCastToStudentComps) {
          studentCompSync = await syncCastMembersToStudentCompsTx(
            tx,
            show.id,
            payload.castMembers || []
          );
        }

        return { performanceIds, studentCompSync };
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_CREATED',
        entityType: 'Performance',
        entityId: created.performanceIds[0],
        metadata: {
          ...payload,
          performanceCount: created.performanceIds.length,
          studentCompSync: created.studentCompSync
        }
      });

      reply.status(201).send({
        id: created.performanceIds[0],
        ids: created.performanceIds,
        studentCompSync: created.studentCompSync
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create performance');
    }
  });

  app.patch('/api/admin/performances/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = updatePerformanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.performance.findUnique({
        where: { id: params.id },
        include: { show: true }
      });
      if (!existing) {
        throw new HttpError(404, 'Performance not found');
      }
      const hasImageDataUrls = hasPerformanceImageDataUrls(parsed.data);
      if (hasImageDataUrls && !isR2Configured()) {
        return reply.status(503).send({ error: 'Image uploads are unavailable because R2/CDN is not configured.' });
      }

      const payload = hasImageDataUrls
        ? await convertPerformanceImageDataUrlsToR2(parsed.data)
        : parsed.data;

      const studentCompTicketsEnabled =
        payload.studentCompTicketsEnabled ?? payload.familyFreeTicketEnabled;

      const studentCompSync = await prisma.$transaction(async (tx) => {
        await tx.performance.update({
          where: { id: params.id },
          data: {
            title: payload.title,
            startsAt: payload.startsAt ? new Date(payload.startsAt) : undefined,
            onlineSalesStartsAt:
              payload.onlineSalesStartsAt === undefined
                ? undefined
                : payload.onlineSalesStartsAt
                  ? new Date(payload.onlineSalesStartsAt)
                  : null,
            salesCutoffAt:
              payload.salesCutoffAt === undefined
                ? undefined
                : payload.salesCutoffAt
                  ? new Date(payload.salesCutoffAt)
                  : null,
            isPublished: payload.isPublished,
            isFundraiser: payload.isFundraiser,
            staffCompsEnabled: payload.staffCompsEnabled,
            staffCompLimitPerUser: payload.staffCompLimitPerUser,
            staffTicketLimit: payload.staffTicketLimit,
            familyFreeTicketEnabled: studentCompTicketsEnabled,
            seatSelectionEnabled: payload.seatSelectionEnabled,
            venue: payload.venue,
            notes: payload.notes
          }
        });

        // Publishing is managed at the show level in the admin wizard.
        // Keep all sibling performance dates in sync to avoid partial live/draft states.
        if (payload.isPublished !== undefined) {
          await tx.performance.updateMany({
            where: { showId: existing.showId },
            data: { isPublished: payload.isPublished }
          });
        }

        await tx.show.update({
          where: { id: existing.showId },
          data: {
            title: payload.title,
            description: payload.description,
            posterUrl: payload.posterUrl,
            type: payload.type,
            year: payload.year,
            accentColor: payload.accentColor
          }
        });

        if (payload.castMembers !== undefined) {
          const existingCastMembers = await tx.castMember.findMany({
            where: { showId: existing.showId },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              name: true,
              schoolEmail: true,
              gradeLevel: true,
              bio: true
            }
          });
          const existingById = new Map(existingCastMembers.map((member) => [member.id, member]));
          const existingByName = new Map<string, (typeof existingCastMembers)[number]>();
          existingCastMembers.forEach((member) => {
            const normalized = normalizeName(member.name);
            if (normalized && !existingByName.has(normalized)) {
              existingByName.set(normalized, member);
            }
          });

          await tx.castMember.deleteMany({
            where: { showId: existing.showId }
          });

          if (payload.castMembers.length > 0) {
            const castRows = payload.castMembers.map((castMember, position) => {
              const existingCastMember =
                (castMember.id ? existingById.get(castMember.id) : undefined) ||
                existingByName.get(normalizeName(castMember.name));

              return {
                showId: existing.showId,
                name: castMember.name,
                role: castMember.role,
                photoUrl: castMember.photoUrl || null,
                schoolEmail:
                  castMember.schoolEmail !== undefined
                    ? castMember.schoolEmail
                      ? castMember.schoolEmail.trim().toLowerCase()
                      : null
                    : existingCastMember?.schoolEmail || null,
                gradeLevel:
                  castMember.gradeLevel !== undefined
                    ? castMember.gradeLevel
                    : existingCastMember?.gradeLevel ?? null,
                bio:
                  castMember.bio !== undefined
                    ? castMember.bio.trim() || null
                    : existingCastMember?.bio || null,
                position
              };
            });

            await tx.castMember.createMany({
              data: castRows
            });
          }
        }

        let castSource: Array<{ name: string; role: string }> = [];
        if (payload.castMembers !== undefined) {
          castSource = payload.castMembers.map((member) => ({ name: member.name, role: member.role }));
        } else if (payload.pushCastToStudentComps) {
          const currentCast = await tx.castMember.findMany({
            where: { showId: existing.showId },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: { name: true, role: true }
          });
          castSource = currentCast;
        }

        if (payload.pricingTiers) {
          await tx.pricingTier.deleteMany({ where: { performanceId: params.id } });
          await tx.pricingTier.createMany({
            data: payload.pricingTiers.map((tier) => ({
              performanceId: params.id,
              name: tier.name,
              priceCents: tier.priceCents
            }))
          });
        }

        if (payload.pushCastToStudentComps) {
          return syncCastMembersToStudentCompsTx(tx, existing.showId, castSource);
        }

        return null;
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_UPDATED',
        entityType: 'Performance',
        entityId: params.id,
        metadata: {
          ...payload,
          studentCompSync
        }
      });

      reply.send({ success: true, studentCompSync });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update performance');
    }
  });

  app.post('/api/admin/performances/:id/archive', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const existing = await prisma.performance.findUnique({
        where: { id: params.id },
        select: { id: true }
      });
      if (!existing) {
        throw new HttpError(404, 'Performance not found');
      }

      const updated = await prisma.performance.update({
        where: { id: params.id },
        data: {
          isArchived: true,
          archivedAt: new Date()
        },
        select: {
          id: true,
          isArchived: true,
          archivedAt: true
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_ARCHIVED',
        entityType: 'Performance',
        entityId: params.id
      });

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to archive performance');
    }
  });

  app.post('/api/admin/performances/:id/restore', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const existing = await prisma.performance.findUnique({
        where: { id: params.id },
        select: { id: true }
      });
      if (!existing) {
        throw new HttpError(404, 'Performance not found');
      }

      const updated = await prisma.performance.update({
        where: { id: params.id },
        data: {
          isArchived: false,
          archivedAt: null
        },
        select: {
          id: true,
          isArchived: true,
          archivedAt: true
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_RESTORED',
        entityType: 'Performance',
        entityId: params.id
      });

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to restore performance');
    }
  });

  app.delete('/api/admin/performances/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsedQuery = deletePerformanceQuerySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }
    const forceDelete = parsedQuery.data.force === '1' || parsedQuery.data.force === 'true';

    try {
      const deleteMeta = await prisma.$transaction(async (tx) => {
        const performance = await tx.performance.findUnique({
          where: { id: params.id },
          select: { id: true, showId: true }
        });
        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }

        const paidOrders = await tx.order.count({
          where: {
            performanceId: params.id,
            status: 'PAID'
          }
        });
        if (paidOrders > 0 && !forceDelete) {
          throw new HttpError(
            409,
            `This performance has ${paidOrders} paid order(s). Confirm again to permanently delete it.`
          );
        }

        const totalOrders = await tx.order.count({ where: { performanceId: params.id } });
        if (totalOrders > 0) {
          await tx.order.deleteMany({ where: { performanceId: params.id } });
        }

        await tx.performance.delete({ where: { id: params.id } });

        return {
          paidOrders,
          totalOrders
        };
      });

      await logAudit({
        actor: adminActor(request),
        action: 'PERFORMANCE_DELETED',
        entityType: 'Performance',
        entityId: params.id,
        metadata: {
          forceDelete,
          paidOrdersDeleted: deleteMeta.paidOrders,
          totalOrdersDeleted: deleteMeta.totalOrders
        }
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to delete performance');
    }
  });
};
