import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { backfillLegacyShowAndCastImagesToR2 } from '../lib/legacy-image-backfill.js';

export const showRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/shows', async (_request, reply) => {
    try {
      const now = new Date();
      const shows = await prisma.show.findMany({
        where: {
          performances: {
            some: {
              isArchived: false,
              isFundraiser: false,
              isPublished: true,
              AND: [
                {
                  OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: now } }]
                },
                {
                  OR: [
                    { salesCutoffAt: { gt: now } },
                    {
                      salesCutoffAt: null,
                      startsAt: { gt: now }
                    }
                  ]
                }
              ]
            }
          }
        },
        orderBy: { year: 'desc' }
      });

      await backfillLegacyShowAndCastImagesToR2(shows);

      reply.send(shows);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch shows');
    }
  });

  app.get('/api/shows/:id', async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const show = await prisma.show.findUnique({
        where: { id: params.id },
        include: {
          castMembers: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
          },
          performances: {
            where: {
              isArchived: false,
              isFundraiser: false,
              isPublished: true,
              OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: new Date() } }]
            },
            orderBy: { startsAt: 'asc' }
          }
        }
      });

      if (!show) {
        throw new HttpError(404, 'Show not found');
      }

      await backfillLegacyShowAndCastImagesToR2([show]);

      reply.send({
        id: show.id,
        title: show.title,
        description: show.description,
        posterUrl: show.posterUrl,
        type: show.type,
        year: show.year,
        accentColor: show.accentColor,
        castMembers: show.castMembers.map((castMember) => ({
          id: castMember.id,
          name: castMember.name,
          role: castMember.role,
          photoUrl: castMember.photoUrl,
          schoolEmail: castMember.schoolEmail,
          gradeLevel: castMember.gradeLevel,
          bio: castMember.bio
        })),
        performances: show.performances.map((performance) => ({
          id: performance.id,
          date: performance.startsAt,
          onlineSalesStartsAt: performance.onlineSalesStartsAt,
          salesCutoffAt: performance.salesCutoffAt,
          salesOpen:
            (!performance.onlineSalesStartsAt || performance.onlineSalesStartsAt <= new Date()) &&
            (performance.salesCutoffAt || performance.startsAt) > new Date()
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch show');
    }
  });
};
