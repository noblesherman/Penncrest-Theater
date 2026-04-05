import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit-log.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { isImageDataUrl } from '../lib/image-data-url.js';
import { isR2Configured, uploadImageFromDataUrl } from '../lib/r2.js';
import {
  aboutPageSlugs,
  aboutSlugSchema,
  buildAboutPageTitle,
  getDefaultAboutPage,
  listDefaultAboutPages,
  parseAboutPageContent,
  type AboutPageContent,
} from '../lib/about-content.js';

const scope = 'about';
const starterAboutSlugSet = new Set<string>(aboutPageSlugs as readonly string[]);
const deletedStarterTombstoneKind = 'deleted_starter_about_page';
const slugParamsSchema = z.object({
  slug: aboutSlugSchema
});

type ContentPageRow = {
  id: string;
  slug: string;
  content: unknown;
  updatedAt: Date;
  updatedByAdminId: string | null;
};

function isMissingContentPageTableError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

function containsImageDataUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    return isImageDataUrl(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsImageDataUrl(item));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((item) => containsImageDataUrl(item));
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim() || 'About Page';
}

function buildTemplatePageForSlug(slug: string): AboutPageContent {
  const starter = getDefaultAboutPage('about') || listDefaultAboutPages()[0];
  if (starter) {
    const next = structuredClone(starter);
    next.slug = slug;
    next.navLabel = titleFromSlug(slug);
    return next;
  }

  return {
    slug,
    navLabel: titleFromSlug(slug),
    hero: {
      eyebrow: 'Penncrest Theater',
      title: titleFromSlug(slug),
      accent: 'Page',
      description: 'Edit this page in Admin > About.'
    },
    sections: [
      {
        id: 'intro',
        type: 'story',
        hidden: false,
        eyebrow: 'Welcome',
        heading: titleFromSlug(slug),
        lead: '',
        paragraphs: ['Update this content in the About editor.'],
        quote: '',
        quoteAttribution: ''
      }
    ]
  };
}

function buildAboutImageFilenameBase(slug: string, path: string[], uploadIndex: number): string {
  const safePath = path
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return safePath ? `${slug}-${safePath}-${uploadIndex}` : `${slug}-image-${uploadIndex}`;
}

async function convertImageDataUrlsToR2(content: AboutPageContent, slug: string): Promise<AboutPageContent> {
  const convertedBySource = new Map<string, string>();
  let uploadIndex = 0;

  const visit = async (value: unknown, path: string[]): Promise<unknown> => {
    if (typeof value === 'string') {
      if (!isImageDataUrl(value)) {
        return value;
      }

      const cached = convertedBySource.get(value);
      if (cached) {
        return cached;
      }

      uploadIndex += 1;
      const uploaded = await uploadImageFromDataUrl({
        dataUrl: value,
        scope: `about/${slug}`,
        filenameBase: buildAboutImageFilenameBase(slug, path, uploadIndex)
      });

      convertedBySource.set(value, uploaded.url);
      return uploaded.url;
    }

    if (Array.isArray(value)) {
      const nextArray: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        nextArray.push(await visit(value[index], [...path, String(index)]));
      }
      return nextArray;
    }

    if (value && typeof value === 'object') {
      const nextObject: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        nextObject[key] = await visit(child, [...path, key]);
      }
      return nextObject;
    }

    return value;
  };

  const converted = await visit(content, []);
  return parseAboutPageContent(converted);
}

function serializeAdminPage(row: ContentPageRow | null, fallbackPage: AboutPageContent) {
  if (row && isDeletedStarterTombstone(row.content, row.slug)) {
    return {
      page: fallbackPage,
      isCustomized: false,
      updatedAt: null,
      updatedByAdminId: null
    };
  }

  if (!row) {
    return {
      page: fallbackPage,
      isCustomized: false,
      updatedAt: null,
      updatedByAdminId: null
    };
  }

  try {
    const parsed = parseAboutPageContent(row.content);
    return {
      page: parsed,
      isCustomized: true,
      updatedAt: row.updatedAt.toISOString(),
      updatedByAdminId: row.updatedByAdminId
    };
  } catch {
    return {
      page: fallbackPage,
      isCustomized: true,
      updatedAt: row.updatedAt.toISOString(),
      updatedByAdminId: row.updatedByAdminId
    };
  }
}

function parseStoredPageForPublic(row: ContentPageRow): AboutPageContent | null {
  if (isDeletedStarterTombstone(row.content, row.slug)) {
    return null;
  }

  try {
    return parseAboutPageContent(row.content);
  } catch {
    return null;
  }
}

function buildDeletedStarterTombstone(slug: string) {
  return {
    _meta: {
      kind: deletedStarterTombstoneKind,
      slug,
      deletedAt: new Date().toISOString(),
      version: 1
    }
  };
}

function isDeletedStarterTombstone(content: unknown, slug: string): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return false;
  }

  const meta = (content as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return false;
  }

  const kind = (meta as { kind?: unknown }).kind;
  const metaSlug = (meta as { slug?: unknown }).slug;
  return kind === deletedStarterTombstoneKind && metaSlug === slug;
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
        },
        select: {
          id: true,
          slug: true,
          content: true,
          updatedAt: true,
          updatedByAdminId: true
        }
      });

      if (row) {
        if (isDeletedStarterTombstone(row.content, params.data.slug)) {
          return reply.status(404).send({ error: 'About page not found' });
        }

        const parsed = parseStoredPageForPublic(row);
        if (parsed) {
          return reply.send(parsed);
        }

        const fallback = getDefaultAboutPage(params.data.slug);
        if (fallback) {
          request.log.warn({ scope, slug: params.data.slug }, 'Invalid stored About content encountered; serving defaults');
          return reply.send(fallback);
        }

        throw new HttpError(500, 'Stored About page content is invalid.');
      }

      const defaultPage = getDefaultAboutPage(params.data.slug);
      if (defaultPage) {
        return reply.send(defaultPage);
      }

      return reply.status(404).send({ error: 'About page not found' });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        const defaultPage = getDefaultAboutPage(params.data.slug);
        if (defaultPage) {
          return reply.send(defaultPage);
        }
        return reply.status(404).send({ error: 'About page not found' });
      }
      handleRouteError(reply, err, 'Failed to load About content');
    }
  });

  app.get('/api/admin/about/pages', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (_request, reply) => {
    try {
      const rows = await prisma.contentPage.findMany({
        where: { scope },
        orderBy: [{ updatedAt: 'desc' }, { slug: 'asc' }],
        select: {
          id: true,
          slug: true,
          content: true,
          updatedAt: true,
          updatedByAdminId: true
        }
      });

      const rowBySlug = new Map(rows.map((row) => [row.slug, row]));
      const payload: Array<{
        page: AboutPageContent;
        isCustomized: boolean;
        updatedAt: string | null;
        updatedByAdminId: string | null;
      }> = [];

      for (const starterSlug of aboutPageSlugs) {
        const row = rowBySlug.get(starterSlug) || null;
        if (row) {
          rowBySlug.delete(starterSlug);
        }

        if (row && isDeletedStarterTombstone(row.content, starterSlug)) {
          continue;
        }

        const fallback = getDefaultAboutPage(starterSlug) || buildTemplatePageForSlug(starterSlug);
        payload.push(serializeAdminPage(row, fallback));
      }

      const customRows = [...rowBySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
      for (const row of customRows) {
        if (isDeletedStarterTombstone(row.content, row.slug)) {
          continue;
        }
        payload.push(serializeAdminPage(row, buildTemplatePageForSlug(row.slug)));
      }

      reply.send(payload);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send(listDefaultAboutPages().map((page) => ({
          page,
          isCustomized: false,
          updatedAt: null,
          updatedByAdminId: null
        })));
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
      if (containsImageDataUrl(content)) {
        if (!isR2Configured()) {
          throw new HttpError(503, 'R2/CDN is not configured. Configure R2 before saving image data URLs.');
        }
        content = await convertImageDataUrlsToR2(content, params.data.slug);
      }

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
        },
        select: {
          id: true,
          slug: true,
          content: true,
          updatedAt: true,
          updatedByAdminId: true
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
          title: buildAboutPageTitle(content)
        }
      });

      reply.send(serializeAdminPage(saved, buildTemplatePageForSlug(params.data.slug)));
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'Failed to save About content');
    }
  });

  app.delete('/api/admin/about/pages/:slug', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    const isStarterSlug = starterAboutSlugSet.has(params.data.slug);

    try {
      const existing = await prisma.contentPage.findUnique({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        select: {
          id: true,
          title: true,
          content: true
        }
      });

      if (isStarterSlug) {
        const tombstone = buildDeletedStarterTombstone(params.data.slug);
        const saved = await prisma.contentPage.upsert({
          where: {
            scope_slug: {
              scope,
              slug: params.data.slug
            }
          },
          update: {
            title: `Deleted starter About page: ${params.data.slug}`,
            content: tombstone as any,
            updatedByAdminId: request.adminUser?.id ?? null
          },
          create: {
            scope,
            slug: params.data.slug,
            title: `Deleted starter About page: ${params.data.slug}`,
            content: tombstone as any,
            updatedByAdminId: request.adminUser?.id ?? null
          },
          select: {
            id: true
          }
        });

        await logAudit({
          actor: request.adminUser?.username || 'super-admin',
          actorAdminId: request.adminUser?.id || null,
          action: 'ABOUT_CONTENT_DELETED',
          entityType: 'ContentPage',
          entityId: existing?.id ?? saved.id,
          metadata: {
            scope,
            slug: params.data.slug,
            title: existing?.title ?? null,
            deletedStarterPage: true
          }
        });

        return reply.send({
          success: true,
          deleted: true,
          restoredDefault: false
        });
      }

      if (!existing) {
        throw new HttpError(404, 'About page not found');
      }

      await prisma.contentPage.delete({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        }
      });

      await logAudit({
        actor: request.adminUser?.username || 'super-admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'ABOUT_CONTENT_DELETED',
        entityType: 'ContentPage',
        entityId: existing.id,
        metadata: {
          scope,
          slug: params.data.slug,
          title: existing.title
        }
      });

      reply.send({
        success: true,
        deleted: true,
        restoredDefault: false
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'Failed to delete About content');
    }
  });
};
