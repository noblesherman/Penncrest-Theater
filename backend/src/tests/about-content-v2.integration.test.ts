import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

const schemaName = `about_v2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_about';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_about';
process.env.JWT_SECRET = 'about-v2-test-secret-12345';
process.env.ADMIN_USERNAME = 'about-admin';
process.env.ADMIN_PASSWORD = 'about-admin-password';

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;
let adminToken: string;

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function getLinkGridCount(page: any): number {
  const section = Array.isArray(page?.sections)
    ? page.sections.find((candidate: any) => candidate?.type === 'linkGrid')
    : null;
  if (!section || !Array.isArray(section.items)) {
    return 0;
  }
  return section.items.filter((item: any) => item?.hidden !== true).length;
}

describe.sequential('about content v2 integration', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL
      },
      stdio: 'pipe'
    });

    ({ prisma } = await import('../lib/prisma.js'));
    ({ createServer } = await import('../server.js'));
    app = await createServer();

    const adminUser = await prisma.adminUser.create({
      data: {
        username: 'about-admin',
        name: 'About Admin',
        passwordHash: 'not-used-in-test',
        role: 'SUPER_ADMIN',
        isActive: true
      }
    });

    adminToken = await app.jwt.sign({
      role: 'admin',
      adminId: adminUser.id,
      adminRole: adminUser.role,
      username: adminUser.username
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('persists draft edits across editor-state reloads', async () => {
    const stateResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/about/v2/editor-state',
      headers: authHeaders(adminToken)
    });

    expect(stateResponse.statusCode).toBe(200);
    const state = stateResponse.json() as any;
    const performerDraft = state.pages.find((page: any) => page.slug === 'performer')?.draftPage;
    expect(performerDraft).toBeTruthy();

    const edited = {
      ...performerDraft,
      hero: {
        ...performerDraft.hero,
        title: `Performer Updated ${Date.now()}`
      }
    };

    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/admin/about/v2/draft/pages/performer',
      headers: {
        ...authHeaders(adminToken),
        'content-type': 'application/json'
      },
      payload: edited
    });

    expect(saveResponse.statusCode).toBe(200);

    const reloadedResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/about/v2/editor-state',
      headers: authHeaders(adminToken)
    });

    expect(reloadedResponse.statusCode).toBe(200);
    const reloaded = reloadedResponse.json() as any;
    const performer = reloaded.pages.find((page: any) => page.slug === 'performer');
    expect(performer.draftPage.hero.title).toBe(edited.hero.title);
    expect(performer.pageChanged).toBe(true);
  });

  it('publishes draft deletion and content changes together', async () => {
    const techPublicBefore = await app.inject({
      method: 'GET',
      url: '/api/content/about/pages/tech-crew'
    });
    expect(techPublicBefore.statusCode).toBe(200);
    const techPage = techPublicBefore.json() as any;

    const techEdited = {
      ...techPage,
      hero: {
        ...techPage.hero,
        accent: `Crew ${Date.now()}`
      }
    };

    const saveTechDraft = await app.inject({
      method: 'PUT',
      url: '/api/admin/about/v2/draft/pages/tech-crew',
      headers: {
        ...authHeaders(adminToken),
        'content-type': 'application/json'
      },
      payload: techEdited
    });
    expect(saveTechDraft.statusCode).toBe(200);

    const stageDeletePerformer = await app.inject({
      method: 'DELETE',
      url: '/api/admin/about/v2/draft/pages/performer',
      headers: authHeaders(adminToken)
    });
    expect(stageDeletePerformer.statusCode).toBe(200);

    const publishResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/about/v2/publish',
      headers: authHeaders(adminToken)
    });
    expect(publishResponse.statusCode).toBe(200);

    const performerPublic = await app.inject({
      method: 'GET',
      url: '/api/content/about/pages/performer'
    });
    expect(performerPublic.statusCode).toBe(404);

    const techPublicAfter = await app.inject({
      method: 'GET',
      url: '/api/content/about/pages/tech-crew'
    });
    expect(techPublicAfter.statusCode).toBe(200);
    const techAfter = techPublicAfter.json() as any;
    expect(techAfter.hero.accent).toBe(techEdited.hero.accent);

    const aboutPublic = await app.inject({
      method: 'GET',
      url: '/api/content/about/pages/about'
    });
    expect(aboutPublic.statusCode).toBe(200);
    const aboutAfter = aboutPublic.json() as any;
    const linkGridItems = Array.isArray(aboutAfter.sections)
      ? aboutAfter.sections.find((section: any) => section?.type === 'linkGrid')?.items ?? []
      : [];
    const performerCard = linkGridItems.find((item: any) => String(item?.href || '').includes('/performer'));
    expect(performerCard).toBeUndefined();
  });

  it('backfills legacy starter gallery sections into editable draft state', async () => {
    const initialStateResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/about/v2/editor-state',
      headers: authHeaders(adminToken)
    });
    expect(initialStateResponse.statusCode).toBe(200);

    const initialState = initialStateResponse.json() as any;
    const stageCrewDraft = initialState.pages.find((page: any) => page.slug === 'stage-crew')?.draftPage;
    expect(stageCrewDraft).toBeTruthy();

    const legacyStageCrewDraft = {
      ...stageCrewDraft,
      sections: Array.isArray(stageCrewDraft.sections)
        ? stageCrewDraft.sections.filter((section: any) => section?.id !== 'stage-crew-gallery')
        : []
    };

    await prisma.contentPage.update({
      where: {
        scope_slug: {
          scope: 'about',
          slug: 'stage-crew'
        }
      },
      data: {
        title: stageCrewDraft.navLabel,
        content: legacyStageCrewDraft as any,
        draftContent: legacyStageCrewDraft as any,
        publishedContent: legacyStageCrewDraft as any,
        draftDeleted: false,
        publishedDeleted: false
      }
    });

    const reloadedStateResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/about/v2/editor-state',
      headers: authHeaders(adminToken)
    });
    expect(reloadedStateResponse.statusCode).toBe(200);

    const reloadedState = reloadedStateResponse.json() as any;
    const reloadedStageCrew = reloadedState.pages.find((page: any) => page.slug === 'stage-crew')?.draftPage;
    expect(reloadedStageCrew).toBeTruthy();

    const reloadedGallerySection = Array.isArray(reloadedStageCrew.sections)
      ? reloadedStageCrew.sections.find((section: any) => section?.id === 'stage-crew-gallery')
      : null;
    expect(reloadedGallerySection).toBeTruthy();
    expect(reloadedGallerySection.type).toBe('splitFeature');

    const storedStageCrewRow = await prisma.contentPage.findUnique({
      where: {
        scope_slug: {
          scope: 'about',
          slug: 'stage-crew'
        }
      },
      select: {
        draftContent: true
      }
    });

    const storedSections = Array.isArray((storedStageCrewRow?.draftContent as any)?.sections)
      ? (storedStageCrewRow?.draftContent as any).sections
      : [];
    expect(storedSections.some((section: any) => section?.id === 'stage-crew-gallery')).toBe(true);
  });

  it('auto-syncs Get Involved card counts for 1, 4, 5, and 12 enabled pages', async () => {
    const ensureDraftPage = async (pageSlug: string) => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/about/v2/draft/pages',
        headers: {
          ...authHeaders(adminToken),
          'content-type': 'application/json'
        },
        payload: {
          slug: pageSlug,
          templateSlug: 'about'
        }
      });
      if (createResponse.statusCode !== 201 && createResponse.statusCode !== 409) {
        throw new Error(`Failed creating page ${pageSlug}: ${createResponse.statusCode}`);
      }
    };

    const configureEnabledSet = async (count: number) => {
      const resetResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/about/v2/draft/reset',
        headers: {
          ...authHeaders(adminToken),
          'content-type': 'application/json'
        },
        payload: {}
      });
      expect(resetResponse.statusCode).toBe(200);

      await ensureDraftPage('performer');

      for (let i = 0; i < 6; i += 1) {
        await ensureDraftPage(`card-target-${i + 1}`);
      }

      const stateResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/about/v2/editor-state',
        headers: authHeaders(adminToken)
      });
      expect(stateResponse.statusCode).toBe(200);
      const state = stateResponse.json() as any;

      const nonAboutSlugs = (state.catalog as any[])
        .map((entry) => String(entry.slug))
        .filter((entrySlug) => entrySlug !== 'about')
        .sort((a, b) => a.localeCompare(b));

      const enabledSet = new Set(nonAboutSlugs.slice(0, count));

      for (const pageSlug of nonAboutSlugs) {
        const patchResponse = await app.inject({
          method: 'PATCH',
          url: `/api/admin/about/v2/draft/catalog/${pageSlug}`,
          headers: {
            ...authHeaders(adminToken),
            'content-type': 'application/json'
          },
          payload: {
            enabled: enabledSet.has(pageSlug),
            deleted: false,
            cardTitle: `Card ${pageSlug}`,
            cardDescription: `Description ${pageSlug}`
          }
        });
        expect(patchResponse.statusCode).toBe(200);
      }

      const publishResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/about/v2/publish',
        headers: authHeaders(adminToken)
      });
      expect(publishResponse.statusCode).toBe(200);

      const aboutResponse = await app.inject({
        method: 'GET',
        url: '/api/content/about/pages/about'
      });
      expect(aboutResponse.statusCode).toBe(200);

      return getLinkGridCount(aboutResponse.json());
    };

    for (const targetCount of [1, 4, 5, 12]) {
      const count = await configureEnabledSet(targetCount);
      expect(count).toBe(targetCount);
    }
  }, 240_000);
});
