import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { releaseExpiredHolds } from '../services/hold-service.js';

function toSeatStatus(status: string): 'available' | 'held' | 'sold' | 'blocked' {
  return status.toLowerCase() as 'available' | 'held' | 'sold' | 'blocked';
}

export const performanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/performances', async (_request, reply) => {
    try {
      await releaseExpiredHolds();

      const performances = await prisma.performance.findMany({
        orderBy: { startsAt: 'asc' },
        include: {
          show: true,
          seats: {
            select: {
              price: true,
              status: true
            }
          }
        }
      });

      const payload = performances.map((performance) => {
        const prices = performance.seats.map((s) => s.price);
        const availableSeats = performance.seats.filter((s) => s.status === 'AVAILABLE').length;
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
          familyFreeTicketEnabled: performance.familyFreeTicketEnabled,
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
      await releaseExpiredHolds();

      const performance = await prisma.performance.findUnique({
        where: { id: params.id },
        include: {
          show: true,
          pricingTiers: true,
          seats: {
            select: {
              sectionName: true,
              status: true,
              price: true
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
            availableSeats: seat.status === 'AVAILABLE' ? 1 : 0,
            minPrice: seat.price,
            maxPrice: seat.price
          });
          return;
        }

        existing.totalSeats += 1;
        if (seat.status === 'AVAILABLE') existing.availableSeats += 1;
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
        familyFreeTicketEnabled: performance.familyFreeTicketEnabled,
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
      await releaseExpiredHolds();

      const seats = await prisma.seat.findMany({
        where: { performanceId: params.performanceId },
        orderBy: [{ sectionName: 'asc' }, { row: 'asc' }, { number: 'asc' }]
      });

      reply.send(
        seats.map((seat) => ({
          id: seat.id,
          row: seat.row,
          number: seat.number,
          x: seat.x,
          y: seat.y,
          status: toSeatStatus(seat.status),
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
