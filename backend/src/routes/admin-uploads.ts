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
