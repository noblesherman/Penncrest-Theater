import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { env } from '../lib/env.js';
import { backfillLegacyShowAndCastImagesToR2 } from '../lib/legacy-image-backfill.js';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const performanceCacheTtlMs = env.NODE_ENV === 'test' ? 0 : env.PERFORMANCE_CACHE_TTL_SECONDS * 1000;
let performanceListCache: CacheEntry<unknown> | null = null;
const performanceDetailCache = new Map<string, CacheEntry<unknown>>();

function readCache<T>(entry: CacheEntry<T> | null | undefined): T | null {
  if (!entry || performanceCacheTtlMs <= 0) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    return null;
  }

  return entry.value;
}

function writeCache<T>(value: T): CacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + performanceCacheTtlMs
  };
}

function toSeatStatus(status: string): 'available' | 'held' | 'sold' | 'blocked' {
  return status.toLowerCase() as 'available' | 'held' | 'sold' | 'blocked';
}

function isSeatEffectivelyAvailable(seat: {
  status: string;
  holdSession?: {
    status: string;
    expiresAt: Date;
  } | null;
}): boolean {
  if (seat.status === 'AVAILABLE') {
    return true;
  }

  if (seat.status !== 'HELD') {
    return false;
  }

  return !seat.holdSession || seat.holdSession.status !== 'ACTIVE' || seat.holdSession.expiresAt < new Date();
}

function getReadableSeatStatus(seat: {
  status: string;
  holdSession?: {
    status: string;
    expiresAt: Date;
  } | null;
}): 'available' | 'held' | 'sold' | 'blocked' {
  if (isSeatEffectivelyAvailable(seat)) {
    return 'available';
  }

  return toSeatStatus(seat.status);
}

export const performanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/performances', async (_request, reply) => {
    try {
      const cached = readCache(performanceListCache);
      if (cached) {
        return reply.send(cached);
      }

      const performances = await prisma.performance.findMany({
        where: {
          isArchived: false,
          isFundraiser: false,
          isPublished: true,
          OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: new Date() } }]
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          title: true,
          startsAt: true,
          onlineSalesStartsAt: true,
          salesCutoffAt: true,
          staffCompsEnabled: true,
          staffCompLimitPerUser: true,
          staffTicketLimit: true,
          familyFreeTicketEnabled: true,
          seatSelectionEnabled: true,
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
              accentColor: true
            }
          }
        }
      });

      await backfillLegacyShowAndCastImagesToR2(performances.map((performance) => performance.show));

      const performanceIds = performances.map((performance) => performance.id);
      const now = new Date();

      const [priceStats, availableStats] = performanceIds.length
        ? await Promise.all([
            prisma.seat.groupBy({
              by: ['performanceId'],
              where: {
                performanceId: {
                  in: performanceIds
                }
              },
              _min: { price: true },
              _max: { price: true }
            }),
            prisma.seat.groupBy({
              by: ['performanceId'],
              where: {
                performanceId: {
                  in: performanceIds
                },
                OR: [
                  { status: 'AVAILABLE' },
                  {
                    status: 'HELD',
                    OR: [
                      { holdSessionId: null },
                      { holdSession: { status: { not: 'ACTIVE' } } },
                      { holdSession: { expiresAt: { lt: now } } }
                    ]
                  }
                ]
              },
              _count: { _all: true }
            })
          ])
        : [[], []];

      const priceStatsByPerformanceId = new Map(
        priceStats.map((stat) => [
          stat.performanceId,
          { minPrice: stat._min.price ?? 0, maxPrice: stat._max.price ?? 0 }
        ])
      );
      const availableStatsByPerformanceId = new Map(
        availableStats.map((stat) => [stat.performanceId, stat._count._all])
      );

      const payload = performances.map((performance) => {
        const goLiveAt = performance.onlineSalesStartsAt || null;
        const isLiveNow = !goLiveAt || goLiveAt <= now;
        const cutoff = performance.salesCutoffAt || performance.startsAt;
        const salesOpen = isLiveNow && cutoff > now;
        const priceStatsForPerformance = priceStatsByPerformanceId.get(performance.id);
        const availableSeats = availableStatsByPerformanceId.get(performance.id) ?? 0;
        return {
          id: performance.id,
          title: performance.title || performance.show.title,
          startsAt: performance.startsAt.toISOString(),
          onlineSalesStartsAt: performance.onlineSalesStartsAt?.toISOString() || null,
          salesCutoffAt: performance.salesCutoffAt?.toISOString() || null,
          salesOpen,
          staffCompsEnabled: performance.staffCompsEnabled,
          staffCompLimitPerUser: performance.staffCompLimitPerUser,
          staffTicketLimit: performance.staffTicketLimit,
          studentCompTicketsEnabled: performance.familyFreeTicketEnabled,
          seatSelectionEnabled: performance.seatSelectionEnabled,
          venue: performance.venue,
          notes: performance.notes,
          show: {
            id: performance.show.id,
            title: performance.show.title,
            description: performance.show.description,
            posterUrl: performance.show.posterUrl,
            type: performance.show.type,
            year: performance.show.year,
            accentColor: performance.show.accentColor
          },
          minPrice: priceStatsForPerformance?.minPrice ?? 0,
          maxPrice: priceStatsForPerformance?.maxPrice ?? 0,
          availableSeats
        };
      });

      performanceListCache = writeCache(payload);
      reply.send(payload);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch performances');
    }
  });

  app.get('/api/performances/:id', async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const cached = readCache(performanceDetailCache.get(params.id));
      if (cached) {
        return reply.send(cached);
      }

      const performance = await prisma.performance.findFirst({
        where: {
          id: params.id,
          isArchived: false,
          isPublished: true,
          OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: new Date() } }]
        },
        include: {
          show: true,
          pricingTiers: true,
          registrationForm: {
            select: {
              status: true,
              publishedVersion: {
                select: {
                  settingsJson: true
                }
              }
            }
          },
          seats: {
            select: {
              sectionName: true,
              status: true,
              price: true,
              holdSession: {
                select: {
                  status: true,
                  expiresAt: true
                }
              }
            }
          }
        }
      });

      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      await backfillLegacyShowAndCastImagesToR2([performance.show]);

      const sectionsMap = new Map<
        string,
        { sectionName: string; totalSeats: number; availableSeats: number; minPrice: number; maxPrice: number }
      >();

      performance.seats.forEach((seat) => {
        const existing = sectionsMap.get(seat.sectionName);
        if (!existing) {
          sectionsMap.set(seat.sectionName, {
            sectionName: seat.sectionName,
            totalSeats: 1,
            availableSeats: isSeatEffectivelyAvailable(seat) ? 1 : 0,
            minPrice: seat.price,
            maxPrice: seat.price
          });
          return;
        }

        existing.totalSeats += 1;
        if (isSeatEffectivelyAvailable(seat)) existing.availableSeats += 1;
        existing.minPrice = Math.min(existing.minPrice, seat.price);
        existing.maxPrice = Math.max(existing.maxPrice, seat.price);
      });

      const payload = {
        id: performance.id,
        title: performance.title || performance.show.title,
        startsAt: performance.startsAt.toISOString(),
        onlineSalesStartsAt: performance.onlineSalesStartsAt?.toISOString() || null,
        salesCutoffAt: performance.salesCutoffAt?.toISOString() || null,
        salesOpen:
          (!performance.onlineSalesStartsAt || performance.onlineSalesStartsAt <= new Date()) &&
          (performance.salesCutoffAt || performance.startsAt) > new Date(),
        staffCompsEnabled: performance.staffCompsEnabled,
        staffCompLimitPerUser: performance.staffCompLimitPerUser,
        staffTicketLimit: performance.staffTicketLimit,
        studentCompTicketsEnabled: performance.familyFreeTicketEnabled,
        seatSelectionEnabled: performance.seatSelectionEnabled,
        registrationFormRequired:
          performance.isFundraiser &&
          performance.registrationForm?.status === 'PUBLISHED' &&
          Boolean(performance.registrationForm.publishedVersion) &&
          (performance.registrationForm.publishedVersion?.settingsJson as any)?.enabled === true,
        venue: performance.venue,
        notes: performance.notes,
        show: {
          id: performance.show.id,
          title: performance.show.title,
          description: performance.show.description,
          posterUrl: performance.show.posterUrl,
          type: performance.show.type,
          year: performance.show.year,
          accentColor: performance.show.accentColor
        },
        pricingTiers: performance.pricingTiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          priceCents: tier.priceCents
        })),
        seatingSections: [...sectionsMap.values()]
      };

      performanceDetailCache.set(params.id, writeCache(payload));
      reply.send(payload);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch performance');
    }
  });

  app.get(
    '/api/performances/:performanceId/seats',
    {
      config: {
        rateLimit: {
          max: 180,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { performanceId: string };

      try {
        const performance = await prisma.performance.findFirst({
          where: {
            id: params.performanceId,
            isArchived: false,
            isPublished: true,
            OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: new Date() } }]
          },
          select: { id: true }
        });
        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }

        const seats = await prisma.seat.findMany({
          where: { performanceId: params.performanceId },
          include: {
            holdSession: {
              select: {
                status: true,
                expiresAt: true
              }
            }
          },
          orderBy: [{ sectionName: 'asc' }, { row: 'asc' }, { number: 'asc' }]
        });

        reply.send(
          seats.map((seat) => ({
            id: seat.id,
            row: seat.row,
            number: seat.number,
            x: seat.x,
            y: seat.y,
            status: getReadableSeatStatus(seat),
            isAccessible: seat.isAccessible,
            isCompanion: seat.isCompanion,
            companionForSeatId: seat.companionForSeatId,
            sectionName: seat.sectionName,
            price: seat.price
          }))
        );
      } catch (err) {
        handleRouteError(reply, err, 'Failed to fetch seats');
      }
    }
  );
};
