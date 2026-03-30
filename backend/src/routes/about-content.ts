import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit-log.js';
import { handleRouteError } from '../lib/route-error.js';
import {
  aboutPageSlugs,
  buildAboutPageTitle,
  getDefaultAboutPage,
  listDefaultAboutPages,
  parseAboutPageContent,
  type AboutPageContent,
  type AboutPageSlug
} from '../lib/about-content.js';

const scope = 'about';
const slugParamsSchema = z.object({
  slug: z.enum(aboutPageSlugs)
});

function isMissingContentPageTableError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

function serializeAdminPage(row: {
  content: unknown;
  updatedAt: Date | null;
  updatedByAdminId: string | null;
} | null, slug: AboutPageSlug) {
  let content = getDefaultAboutPage(slug);
  let isCustomized = false;

  if (row) {
    isCustomized = true;
    try {
      content = parseAboutPageContent(row.content);
    } catch {
      // Keep the editor functional even if previously stored content is invalid.
      isCustomized = false;
    }
  }

  return {
    page: content,
    isCustomized,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedByAdminId: row?.updatedByAdminId ?? null
  };
}

async function loadStoredPages(): Promise<Map<AboutPageSlug, { content: unknown; updatedAt: Date; updatedByAdminId: string | null }>> {
  const rows = await prisma.contentPage.findMany({
    where: { scope }
  });

  const bySlug = new Map<AboutPageSlug, { content: unknown; updatedAt: Date; updatedByAdminId: string | null }>();
  rows.forEach((row) => {
    if ((aboutPageSlugs as readonly string[]).includes(row.slug)) {
      bySlug.set(row.slug as AboutPageSlug, {
        content: row.content,
        updatedAt: row.updatedAt,
        updatedByAdminId: row.updatedByAdminId
      });
    }
  });

  return bySlug;
}

export const aboutContentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/content/about/pages/:slug', async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    try {
      const row = await prisma.contentPage.findUnique({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        }
      });

      let page = getDefaultAboutPage(params.data.slug);
      if (row) {
        try {
          page = parseAboutPageContent(row.content);
        } catch {
          request.log.warn(
            { scope, slug: params.data.slug },
            'Invalid stored About content encountered; serving defaults'
          );
        }
      }
      reply.send(page);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send(getDefaultAboutPage(params.data.slug));
        return;
      }
      handleRouteError(reply, err, 'Failed to load About content');
    }
  });

  app.get('/api/admin/about/pages', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (_request, reply) => {
    try {
      const storedPages = await loadStoredPages();
      reply.send(
        aboutPageSlugs.map((slug) => serializeAdminPage(storedPages.get(slug) ?? null, slug))
      );
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send(
          aboutPageSlugs.map((slug) => serializeAdminPage(null, slug))
        );
        return;
      }
      handleRouteError(reply, err, 'Failed to load About editor');
    }
  });

  app.get('/api/admin/about/pages/defaults', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (_request, reply) => {
    reply.send(listDefaultAboutPages());
  });

  app.put('/api/admin/about/pages/:slug', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    const parsed = z.unknown().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid page payload' });
    }

    let content: AboutPageContent;
    try {
      content = parseAboutPageContent(parsed.data);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Invalid About page content'
      });
    }

    if (content.slug !== params.data.slug) {
      return reply.status(400).send({ error: 'Page slug does not match the requested route' });
    }

    try {
      const saved = await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        update: {
          title: buildAboutPageTitle(content),
          content: content as any,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: params.data.slug,
          title: buildAboutPageTitle(content),
          content: content as any,
          updatedByAdminId: request.adminUser?.id ?? null
        }
      });

      await logAudit({
        actor: request.adminUser?.username || 'super-admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'ABOUT_CONTENT_UPDATED',
        entityType: 'ContentPage',
        entityId: saved.id,
        metadata: {
          scope,
          slug: params.data.slug,
          title: saved.title
        }
      });

      reply.send(serializeAdminPage(saved, params.data.slug));
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'Failed to save About content');
    }
  });
};
