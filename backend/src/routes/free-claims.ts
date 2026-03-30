import { FastifyPluginAsync } from 'fastify';
export const freeClaimRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/staff-tickets/claim', async (_request, reply) => {
    return reply.status(410).send({
      error:
        'Legacy staff claims are disabled. Use teacher promo code checkout at /tickets/staff-comp/reserve.'
    });
  });
  app.post('/api/family-ticket/claim', async (_request, reply) => {
    return reply.status(410).send({
      error:
        'Family free tickets are no longer offered. Use the student-in-show ticket flow if applicable.'
    });
  });
};
