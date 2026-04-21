import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { logAudit } from '../lib/audit-log.js';

const SPONSOR_SCOPE = 'fundraising';
const SPONSOR_SLUG = 'sponsors';
const CANONICAL_FRONTEND_URL = 'https://www.penncresttheater.com';

const sponsorTierCurrentSchema = z.enum(['Balcony', 'Mezzanine', 'Orchestra', 'Center Stage']);
const sponsorTierLegacySchema = z.enum(['Gold', 'Silver', 'Bronze']);
type SponsorTier = z.infer<typeof sponsorTierCurrentSchema>;

function normalizeSponsorTier(tier: z.infer<typeof sponsorTierCurrentSchema> | z.infer<typeof sponsorTierLegacySchema>): SponsorTier {
  switch (tier) {
    case 'Gold':
      return 'Center Stage';
    case 'Silver':
      return 'Orchestra';
    case 'Bronze':
      return 'Mezzanine';
    default:
      return tier;
  }
}

const sponsorTierSchema = z.union([sponsorTierCurrentSchema, sponsorTierLegacySchema]).transform(
  (tier): SponsorTier => normalizeSponsorTier(tier)
);
const sponsorSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(140),
  tier: sponsorTierSchema,
  logoUrl: z.string().url().max(2000),
  imageUrl: z.string().url().max(2000),
  spotlight: z.string().trim().min(1).max(400),
  websiteUrl: z.string().url().max(2000)
});

const sponsorInputSchema = sponsorSchema.omit({ id: true });
const sponsorPatchSchema = sponsorInputSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update'
});
const sponsorListSchema = z.array(sponsorSchema).max(120);
const sponsorIdParamsSchema = z.object({ id: z.string().min(1) });

const defaultFundraisingSponsors: z.infer<typeof sponsorSchema>[] = [
  {
    id: 'sponsor-main-street-bank',
    name: 'Main Street Bank',
    tier: 'Center Stage',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/991b1b.png&text=Main+Street+Bank',
    imageUrl: 'https://picsum.photos/id/1025/900/600',
    spotlight: 'Supporting production sound upgrades and student leadership scholarships.',
    websiteUrl: CANONICAL_FRONTEND_URL
  },
  {
    id: 'sponsor-media-arts-council',
    name: 'Media Arts Council',
    tier: 'Orchestra',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/7f1d1d.png&text=Media+Arts+Council',
    imageUrl: 'https://picsum.photos/id/1038/900/600',
    spotlight: 'Funding scenic art materials and seasonal community arts collaborations.',
    websiteUrl: CANONICAL_FRONTEND_URL
  },
  {
    id: 'sponsor-rose-tree-dental',
    name: 'Rose Tree Dental',
    tier: 'Mezzanine',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/b45309.png&text=Rose+Tree+Dental',
    imageUrl: 'https://picsum.photos/id/1067/900/600',
    spotlight: 'Helping cover student costume and wardrobe costs.',
    websiteUrl: CANONICAL_FRONTEND_URL
  },
  {
    id: 'sponsor-miller-family-foundation',
    name: 'Miller Family Foundation',
    tier: 'Orchestra',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/78350f.png&text=Miller+Family+Foundation',
    imageUrl: 'https://picsum.photos/id/1011/900/600',
    spotlight: 'Providing annual support for student theater training opportunities.',
    websiteUrl: CANONICAL_FRONTEND_URL
  },
  {
    id: 'sponsor-cedar-realty-group',
    name: 'Cedar Realty Group',
    tier: 'Mezzanine',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/92400e.png&text=Cedar+Realty+Group',
    imageUrl: 'https://picsum.photos/id/1041/900/600',
    spotlight: 'Backing front-of-house improvements and audience accessibility support.',
    websiteUrl: CANONICAL_FRONTEND_URL
  },
  {
    id: 'sponsor-brightline-fitness',
    name: 'Brightline Fitness',
    tier: 'Balcony',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/1f2937.png&text=Brightline+Fitness',
    imageUrl: 'https://picsum.photos/id/1050/900/600',
    spotlight: 'Contributing to rehearsal wellness supplies and cast support kits.',
    websiteUrl: CANONICAL_FRONTEND_URL
  }
];

function isMissingContentPageTableError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

async function loadSponsorStore(): Promise<{
  sponsors: z.infer<typeof sponsorSchema>[];
  isCustomized: boolean;
  updatedAt: string | null;
}> {
  const row = await prisma.contentPage.findUnique({
    where: {
      scope_slug: {
        scope: SPONSOR_SCOPE,
        slug: SPONSOR_SLUG
      }
    }
  });

  if (!row) {
    return {
      sponsors: defaultFundraisingSponsors,
      isCustomized: false,
      updatedAt: null
    };
  }

  const parsed = sponsorListSchema.safeParse(row.content);
  if (!parsed.success) {
    return {
      sponsors: defaultFundraisingSponsors,
      isCustomized: false,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  return {
    sponsors: parsed.data,
    isCustomized: true,
    updatedAt: row.updatedAt.toISOString()
  };
}

async function saveSponsorStore(sponsors: z.infer<typeof sponsorSchema>[], adminId?: string | null) {
  return prisma.contentPage.upsert({
    where: {
      scope_slug: {
        scope: SPONSOR_SCOPE,
        slug: SPONSOR_SLUG
      }
    },
    update: {
      title: 'Fundraising Sponsors',
      content: sponsors as unknown as Prisma.InputJsonValue,
      updatedByAdminId: adminId ?? null
    },
    create: {
      scope: SPONSOR_SCOPE,
      slug: SPONSOR_SLUG,
      title: 'Fundraising Sponsors',
      content: sponsors as unknown as Prisma.InputJsonValue,
      updatedByAdminId: adminId ?? null
    }
  });
}

export const fundraisingSponsorRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/fundraising/sponsors', async (_request, reply) => {
    try {
      const { sponsors } = await loadSponsorStore();
      reply.send(sponsors);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send(defaultFundraisingSponsors);
        return;
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch fundraising sponsors');
    }
  });

  app.get('/api/admin/fundraising/sponsors', { preHandler: app.authenticateAdmin }, async (_request, reply) => {
    try {
      const payload = await loadSponsorStore();
      reply.send(payload);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.send({
          sponsors: defaultFundraisingSponsors,
          isCustomized: false,
          updatedAt: null
        });
        return;
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch sponsor admin data');
    }
  });

  app.post('/api/admin/fundraising/sponsors', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = sponsorInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const { sponsors } = await loadSponsorStore();
      const created = {
        id: `sponsor-${crypto.randomUUID()}`,
        ...parsed.data
      };

      const nextSponsors = [created, ...sponsors];
      const saved = await saveSponsorStore(nextSponsors, request.adminUser?.id ?? null);

      await logAudit({
        actor: request.user?.username || request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'FUNDRAISING_SPONSOR_CREATED',
        entityType: 'ContentPage',
        entityId: saved.id,
        metadata: {
          sponsorId: created.id,
          sponsorName: created.name
        }
      });

      reply.status(201).send(created);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'Sponsor storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to create sponsor');
    }
  });

  app.patch('/api/admin/fundraising/sponsors/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = sponsorIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.flatten() });
    }
    const parsed = sponsorPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const { sponsors } = await loadSponsorStore();
      const index = sponsors.findIndex((sponsor) => sponsor.id === params.data.id);
      if (index < 0) {
        throw new HttpError(404, 'Sponsor not found');
      }

      const candidate = {
        ...sponsors[index],
        ...parsed.data
      };
      const validated = sponsorSchema.parse(candidate);

      const nextSponsors = [...sponsors];
      nextSponsors[index] = validated;
      const saved = await saveSponsorStore(nextSponsors, request.adminUser?.id ?? null);

      await logAudit({
        actor: request.user?.username || request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'FUNDRAISING_SPONSOR_UPDATED',
        entityType: 'ContentPage',
        entityId: saved.id,
        metadata: {
          sponsorId: validated.id,
          sponsorName: validated.name
        }
      });

      reply.send(validated);
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'Sponsor storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to update sponsor');
    }
  });

  app.delete('/api/admin/fundraising/sponsors/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = sponsorIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.flatten() });
    }

    try {
      const { sponsors } = await loadSponsorStore();
      const index = sponsors.findIndex((sponsor) => sponsor.id === params.data.id);
      if (index < 0) {
        throw new HttpError(404, 'Sponsor not found');
      }

      const removed = sponsors[index];
      const nextSponsors = sponsors.filter((sponsor) => sponsor.id !== params.data.id);
      const saved = await saveSponsorStore(nextSponsors, request.adminUser?.id ?? null);

      await logAudit({
        actor: request.user?.username || request.adminUser?.username || 'admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'FUNDRAISING_SPONSOR_DELETED',
        entityType: 'ContentPage',
        entityId: saved.id,
        metadata: {
          sponsorId: removed.id,
          sponsorName: removed.name
        }
      });

      reply.send({ success: true });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'Sponsor storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete sponsor');
    }
  });
};
