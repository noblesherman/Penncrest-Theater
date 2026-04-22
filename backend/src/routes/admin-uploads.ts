/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/admin-uploads.ts`
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
import { z } from 'zod';
import { handleRouteError } from '../lib/route-error.js';
import { uploadImageFromDataUrl, uploadPdfFromDataUrl } from '../lib/r2.js';

const uploadImageSchema = z.object({
  dataUrl: z.string().trim().min(1).max(9_000_000),
  scope: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9/_-]+$/, 'Scope can only include letters, numbers, slash, underscore, and hyphen')
    .default('general'),
  filenameBase: z.string().trim().min(1).max(120).optional()
});

const uploadPdfSchema = z.object({
  dataUrl: z.string().trim().min(1).max(16_000_000),
  scope: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9/_-]+$/, 'Scope can only include letters, numbers, slash, underscore, and hyphen')
    .default('trip-documents'),
  filenameBase: z.string().trim().min(1).max(120).optional()
});

export const adminUploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/admin/uploads/image', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = uploadImageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const uploaded = await uploadImageFromDataUrl(parsed.data);
      reply.status(201).send(uploaded);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to upload image');
    }
  });

  app.post('/api/admin/uploads/pdf', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = uploadPdfSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const uploaded = await uploadPdfFromDataUrl(parsed.data);
      reply.status(201).send(uploaded);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to upload PDF');
    }
  });
};
