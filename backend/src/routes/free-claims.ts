/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/free-claims.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
