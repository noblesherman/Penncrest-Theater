import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';

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
              OR: [
                { salesCutoffAt: { gt: now } },
                {
                  salesCutoffAt: null,
                  startsAt: { gt: now }
                }
              ]
            }
          }
        },
        orderBy: { year: 'desc' }
      });

      reply.send(shows);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch shows');
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
              isFundraiser: false
            },
            orderBy: { startsAt: 'asc' }
          }
        }
      });

      if (!show) {
        throw new HttpError(404, 'Show not found');
      }

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
          salesCutoffAt: performance.salesCutoffAt,
          salesOpen: (performance.salesCutoffAt || performance.startsAt) > new Date()
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch show');
    }
  });
};
