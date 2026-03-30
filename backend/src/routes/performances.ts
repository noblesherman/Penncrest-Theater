import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';

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
      const performances = await prisma.performance.findMany({
        where: { isArchived: false, isFundraiser: false },
        orderBy: { startsAt: 'asc' },
        include: {
          show: true,
          seats: {
            select: {
              price: true,
              status: true,
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

      const payload = performances.map((performance) => {
        const prices = performance.seats.map((s) => s.price);
        const availableSeats = performance.seats.filter((seat) => isSeatEffectivelyAvailable(seat)).length;
        const cutoff = performance.salesCutoffAt || performance.startsAt;
        const salesOpen = cutoff > new Date();
        return {
          id: performance.id,
          title: performance.title || performance.show.title,
          startsAt: performance.startsAt.toISOString(),
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
          minPrice: prices.length ? Math.min(...prices) : 0,
          maxPrice: prices.length ? Math.max(...prices) : 0,
          availableSeats
        };
      });

      reply.send(payload);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch performances');
    }
  });

  app.get('/api/performances/:id', async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const performance = await prisma.performance.findFirst({
        where: { id: params.id, isArchived: false },
        include: {
          show: true,
          pricingTiers: true,
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

      reply.send({
        id: performance.id,
        title: performance.title || performance.show.title,
        startsAt: performance.startsAt.toISOString(),
        salesCutoffAt: performance.salesCutoffAt?.toISOString() || null,
        salesOpen: (performance.salesCutoffAt || performance.startsAt) > new Date(),
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
        pricingTiers: performance.pricingTiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          priceCents: tier.priceCents
        })),
        seatingSections: [...sectionsMap.values()]
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch performance');
    }
  });

  app.get('/api/performances/:performanceId/seats', async (request, reply) => {
    const params = request.params as { performanceId: string };

    try {
      const performance = await prisma.performance.findFirst({
        where: { id: params.performanceId, isArchived: false },
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
  });
};
