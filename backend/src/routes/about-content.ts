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
const deletedAboutTombstoneKind = 'deleted_about_page';

const STARTER_PUBLIC_PATHS: Record<string, string> = {
  about: '/about',
  performer: '/performer',
  'stage-crew': '/stage-crew',
  'musical-theater': '/musical-theater',
  'tech-crew': '/tech-crew',
  'costume-crew': '/costume-crew',
  'set-design': '/set-design',
};

const STARTER_SLUG_BY_PATH = new Map(
  Object.entries(STARTER_PUBLIC_PATHS).map(([slug, path]) => [path, slug])
);

const slugParamsSchema = z.object({
  slug: aboutSlugSchema
});

const createDraftPageSchema = z.object({
  slug: aboutSlugSchema,
  templateSlug: aboutSlugSchema.optional()
});

const resetDraftSchema = z
  .object({
    slug: aboutSlugSchema.optional()
  })
  .default({});

const longCardTextSchema = z.string().trim().max(2_000).default('');
const shortCardTextSchema = z.string().trim().min(1).max(160);

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRelativePath(value: string): boolean {
  return value.startsWith('/');
}

const catalogImageSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2_000_000)
    .refine((value) => isHttpUrl(value) || isImageDataUrl(value) || isRelativePath(value), {
      message: 'Card image must be an image URL, image data URL, or site-relative path'
    }),
  alt: z.string().trim().max(180).default('')
});

const catalogStateSchema = z.object({
  enabled: z.boolean().default(true),
  order: z.number().int().min(-1_000).max(100_000).default(0),
  cardTitle: shortCardTextSchema,
  cardDescription: longCardTextSchema,
  cardImage: catalogImageSchema.optional(),
  deleted: z.boolean().default(false)
});

const catalogPatchSchema = catalogStateSchema.partial();

type AboutCatalogState = z.infer<typeof catalogStateSchema>;
type AboutCatalogPatch = z.infer<typeof catalogPatchSchema>;
type AboutImage = z.infer<typeof catalogImageSchema>;

type ContentPageRow = {
  id: string;
  slug: string;
  title: string;
  content: unknown;
  draftContent: unknown | null;
  publishedContent: unknown | null;
  catalogDraft: unknown | null;
  catalogPublished: unknown | null;
  draftDeleted: boolean;
  publishedDeleted: boolean;
  updatedAt: Date;
  updatedByAdminId: string | null;
};

type ResolvedAboutState = {
  row: ContentPageRow | null;
  slug: string;
  isStarter: boolean;
  draftPage: AboutPageContent | null;
  publishedPage: AboutPageContent | null;
  draftDeleted: boolean;
  publishedDeleted: boolean;
  draftCatalog: AboutCatalogState;
  publishedCatalog: AboutCatalogState;
  draftUpdatedAt: string | null;
  publishedUpdatedAt: string | null;
  pageChanged: boolean;
  catalogChanged: boolean;
  changed: boolean;
};

type AboutDraftDeltaSummary = {
  totalChanged: number;
  changedPages: number;
  changedCatalog: number;
  stagedDeletions: number;
};

type AdminAboutEditorState = {
  pages: Array<{
    slug: string;
    isStarter: boolean;
    draftPage: AboutPageContent | null;
    publishedPage: AboutPageContent | null;
    draftDeleted: boolean;
    publishedDeleted: boolean;
    draftUpdatedAt: string | null;
    publishedUpdatedAt: string | null;
    pageChanged: boolean;
  }>;
  catalog: Array<{
    slug: string;
    isStarter: boolean;
    publicPath: string;
    draft: AboutCatalogState;
    published: AboutCatalogState;
    changed: boolean;
  }>;
  defaults: AboutPageContent[];
  draftDelta: AboutDraftDeltaSummary;
};

const aboutRowSelect = {
  id: true,
  slug: true,
  title: true,
  content: true,
  draftContent: true,
  publishedContent: true,
  catalogDraft: true,
  catalogPublished: true,
  draftDeleted: true,
  publishedDeleted: true,
  updatedAt: true,
  updatedByAdminId: true
} satisfies Prisma.ContentPageSelect;

function isMissingContentPageTableError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseStoredPage(value: unknown, slug: string): AboutPageContent | null {
  try {
    const parsed = parseAboutPageContent(value);
    if (parsed.slug === slug) {
      return parsed;
    }

    return {
      ...parsed,
      slug
    };
  } catch {
    return null;
  }
}

function normalizeInternalPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

function publicPathForSlug(slug: string): string {
  return STARTER_PUBLIC_PATHS[slug] ?? `/${slug}`;
}

function slugFromPath(path: string): string | null {
  const starterSlug = STARTER_SLUG_BY_PATH.get(path);
  if (starterSlug) {
    return starterSlug;
  }

  if (!path.startsWith('/')) {
    return null;
  }

  const candidate = path.slice(1).trim().toLowerCase();
  if (!candidate) {
    return null;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) {
    return null;
  }

  return candidate;
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

function buildDeletedTombstone(slug: string, isStarter: boolean) {
  return {
    _meta: {
      kind: isStarter ? deletedStarterTombstoneKind : deletedAboutTombstoneKind,
      slug,
      deletedAt: new Date().toISOString(),
      version: 2
    }
  };
}

function isDeletedTombstone(content: unknown, slug: string): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return false;
  }

  const meta = (content as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return false;
  }

  const kind = (meta as { kind?: unknown }).kind;
  const metaSlug = (meta as { slug?: unknown }).slug;
  return (
    (kind === deletedStarterTombstoneKind || kind === deletedAboutTombstoneKind) &&
    metaSlug === slug
  );
}

function getLegacyPublishedRaw(row: ContentPageRow): unknown {
  if (row.publishedContent !== null) {
    return row.publishedContent;
  }
  return row.content;
}

function getLegacyDraftRaw(row: ContentPageRow): unknown {
  if (row.draftContent !== null) {
    return row.draftContent;
  }
  return getLegacyPublishedRaw(row);
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

async function convertCatalogImageDataUrlToR2(catalog: AboutCatalogState, slug: string): Promise<AboutCatalogState> {
  if (!catalog.cardImage?.url || !isImageDataUrl(catalog.cardImage.url)) {
    return catalog;
  }

  const uploaded = await uploadImageFromDataUrl({
    dataUrl: catalog.cardImage.url,
    scope: `about/${slug}/card`,
    filenameBase: `${slug}-card-image`
  });

  return {
    ...catalog,
    cardImage: {
      url: uploaded.url,
      alt: catalog.cardImage.alt
    }
  };
}

function defaultOrderMap(slugs: Iterable<string>): Map<string, number> {
  const map = new Map<string, number>();

  aboutPageSlugs.forEach((slug, index) => {
    map.set(slug, index * 10);
  });

  const customSlugs = [...new Set(Array.from(slugs).filter((slug) => !starterAboutSlugSet.has(slug)))].sort((a, b) =>
    a.localeCompare(b)
  );

  customSlugs.forEach((slug, index) => {
    map.set(slug, 100 + index * 10);
  });

  return map;
}

type CardSeed = {
  title: string;
  description: string;
  image?: AboutImage;
};

function extractCardSeedBySlug(aboutPage: AboutPageContent | null): Map<string, CardSeed> {
  const seed = new Map<string, CardSeed>();
  if (!aboutPage) {
    return seed;
  }

  for (const section of aboutPage.sections) {
    if (section.type !== 'linkGrid') {
      continue;
    }

    for (const item of section.items) {
      const normalizedPath = normalizeInternalPath(item.href);
      if (!normalizedPath) {
        continue;
      }

      const slug = slugFromPath(normalizedPath);
      if (!slug || seed.has(slug)) {
        continue;
      }

      seed.set(slug, {
        title: item.title,
        description: item.description,
        image: item.image
      });
    }
  }

  return seed;
}

function normalizeCatalogState(raw: unknown, fallback: AboutCatalogState): AboutCatalogState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fallback;
  }

  const merged = {
    ...fallback,
    ...(raw as Record<string, unknown>)
  };

  const parsed = catalogStateSchema.safeParse(merged);
  if (!parsed.success) {
    return fallback;
  }

  if (parsed.data.deleted) {
    return {
      ...parsed.data,
      enabled: false
    };
  }

  return parsed.data;
}

function buildDefaultCatalogState(args: {
  slug: string;
  page: AboutPageContent;
  seed: CardSeed | undefined;
  order: number;
}): AboutCatalogState {
  const { slug, page, seed, order } = args;

  return {
    enabled: slug !== 'about',
    order,
    cardTitle: seed?.title?.trim() || page.navLabel || titleFromSlug(slug),
    cardDescription: seed?.description?.trim() || page.hero.description || '',
    cardImage: seed?.image,
    deleted: false
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function sortResolvedStates(states: ResolvedAboutState[]): ResolvedAboutState[] {
  return [...states].sort((a, b) => {
    if (a.slug === 'about' && b.slug !== 'about') return -1;
    if (b.slug === 'about' && a.slug !== 'about') return 1;

    const orderDelta = a.draftCatalog.order - b.draftCatalog.order;
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return a.slug.localeCompare(b.slug);
  });
}

function buildDraftDeltaSummary(states: ResolvedAboutState[]): AboutDraftDeltaSummary {
  return {
    totalChanged: states.filter((state) => state.changed).length,
    changedPages: states.filter((state) => state.pageChanged).length,
    changedCatalog: states.filter((state) => state.catalogChanged).length,
    stagedDeletions: states.filter((state) => state.draftDeleted).length
  };
}

function toEditorStatePayload(states: ResolvedAboutState[]): AdminAboutEditorState {
  const sorted = sortResolvedStates(states);

  return {
    pages: sorted.map((state) => ({
      slug: state.slug,
      isStarter: state.isStarter,
      draftPage: state.draftPage,
      publishedPage: state.publishedPage,
      draftDeleted: state.draftDeleted,
      publishedDeleted: state.publishedDeleted,
      draftUpdatedAt: state.draftUpdatedAt,
      publishedUpdatedAt: state.publishedUpdatedAt,
      pageChanged: state.pageChanged
    })),
    catalog: sorted.map((state) => ({
      slug: state.slug,
      isStarter: state.isStarter,
      publicPath: publicPathForSlug(state.slug),
      draft: state.draftCatalog,
      published: state.publishedCatalog,
      changed: state.catalogChanged
    })),
    defaults: listDefaultAboutPages(),
    draftDelta: buildDraftDeltaSummary(sorted)
  };
}

function resolveStateForMissingRow(
  slug: string,
  orderMap: Map<string, number>,
  seedMap: Map<string, CardSeed>
): ResolvedAboutState {
  const fallbackPage = getDefaultAboutPage(slug) || buildTemplatePageForSlug(slug);
  const catalog = buildDefaultCatalogState({
    slug,
    page: fallbackPage,
    seed: seedMap.get(slug),
    order: orderMap.get(slug) ?? 0
  });

  return {
    row: null,
    slug,
    isStarter: starterAboutSlugSet.has(slug),
    draftPage: fallbackPage,
    publishedPage: fallbackPage,
    draftDeleted: false,
    publishedDeleted: false,
    draftCatalog: catalog,
    publishedCatalog: catalog,
    draftUpdatedAt: null,
    publishedUpdatedAt: null,
    pageChanged: false,
    catalogChanged: false,
    changed: false
  };
}

function resolveStateForRow(
  row: ContentPageRow,
  orderMap: Map<string, number>,
  seedMap: Map<string, CardSeed>
): ResolvedAboutState {
  const slug = row.slug;
  const isStarter = starterAboutSlugSet.has(slug);

  const publishedRaw = getLegacyPublishedRaw(row);
  const draftRaw = getLegacyDraftRaw(row);

  const publishedDeleted = row.publishedDeleted || isDeletedTombstone(publishedRaw, slug);
  const draftDeleted = row.draftDeleted || isDeletedTombstone(draftRaw, slug);

  const parsedPublished = publishedDeleted ? null : parseStoredPage(publishedRaw, slug);
  const parsedDraft = draftDeleted ? null : parseStoredPage(draftRaw, slug);

  const fallbackPage = getDefaultAboutPage(slug) || buildTemplatePageForSlug(slug);

  const publishedPage = publishedDeleted ? null : parsedPublished ?? fallbackPage;
  const draftPage = draftDeleted ? null : parsedDraft ?? publishedPage ?? fallbackPage;

  const sourcePageForCatalog = draftPage ?? publishedPage ?? fallbackPage;
  const defaultCatalog = buildDefaultCatalogState({
    slug,
    page: sourcePageForCatalog,
    seed: seedMap.get(slug),
    order: orderMap.get(slug) ?? 0
  });

  const normalizedPublishedCatalog = normalizeCatalogState(row.catalogPublished, defaultCatalog);
  const normalizedDraftCatalog = normalizeCatalogState(row.catalogDraft, normalizedPublishedCatalog);

  const publishedCatalog = publishedDeleted
    ? { ...normalizedPublishedCatalog, deleted: true, enabled: false }
    : normalizedPublishedCatalog;

  const draftCatalog = draftDeleted
    ? { ...normalizedDraftCatalog, deleted: true, enabled: false }
    : normalizedDraftCatalog;

  const pageChanged =
    draftDeleted !== publishedDeleted ||
    stableStringify(draftPage) !== stableStringify(publishedPage);

  const catalogChanged = stableStringify(draftCatalog) !== stableStringify(publishedCatalog);

  return {
    row,
    slug,
    isStarter,
    draftPage,
    publishedPage,
    draftDeleted,
    publishedDeleted,
    draftCatalog,
    publishedCatalog,
    draftUpdatedAt: row.updatedAt.toISOString(),
    publishedUpdatedAt: row.updatedAt.toISOString(),
    pageChanged,
    catalogChanged,
    changed: pageChanged || catalogChanged
  };
}

function buildLegacyContentFromPublished(state: {
  slug: string;
  isStarter: boolean;
  publishedDeleted: boolean;
  publishedPage: AboutPageContent | null;
}): unknown {
  if (state.publishedDeleted || !state.publishedPage) {
    return buildDeletedTombstone(state.slug, state.isStarter);
  }

  return state.publishedPage;
}

async function ensureStarterRowsExist(rows: ContentPageRow[]): Promise<void> {
  const existingSlugs = new Set(rows.map((row) => row.slug));
  const orderMap = defaultOrderMap(existingSlugs);

  const aboutCandidate = rows.find((row) => row.slug === 'about');
  const aboutPage = aboutCandidate
    ? parseStoredPage(getLegacyPublishedRaw(aboutCandidate), 'about')
    : getDefaultAboutPage('about');
  const seedMap = extractCardSeedBySlug(aboutPage ?? null);

  for (const starterSlug of aboutPageSlugs) {
    if (existingSlugs.has(starterSlug)) {
      continue;
    }

    const fallbackPage = getDefaultAboutPage(starterSlug) || buildTemplatePageForSlug(starterSlug);
    const catalog = buildDefaultCatalogState({
      slug: starterSlug,
      page: fallbackPage,
      seed: seedMap.get(starterSlug),
      order: orderMap.get(starterSlug) ?? 0
    });

    await prisma.contentPage.create({
      data: {
        scope,
        slug: starterSlug,
        title: buildAboutPageTitle(fallbackPage),
        content: toJson(fallbackPage),
        draftContent: toJson(fallbackPage),
        publishedContent: toJson(fallbackPage),
        catalogDraft: toJson(catalog),
        catalogPublished: toJson(catalog),
        draftDeleted: false,
        publishedDeleted: false
      }
    });
  }
}

async function hydrateAboutV2Rows(): Promise<void> {
  const rows = await prisma.contentPage.findMany({
    where: { scope },
    select: aboutRowSelect,
    orderBy: [{ slug: 'asc' }]
  });

  await ensureStarterRowsExist(rows as ContentPageRow[]);

  const hydratedRows = (await prisma.contentPage.findMany({
    where: { scope },
    select: aboutRowSelect,
    orderBy: [{ slug: 'asc' }]
  })) as ContentPageRow[];

  const allSlugs = new Set(hydratedRows.map((row) => row.slug));
  const orderMap = defaultOrderMap(allSlugs);

  const aboutRow = hydratedRows.find((row) => row.slug === 'about') || null;
  const aboutPage = aboutRow
    ? parseStoredPage(getLegacyPublishedRaw(aboutRow), 'about') || getDefaultAboutPage('about')
    : getDefaultAboutPage('about');
  const seedMap = extractCardSeedBySlug(aboutPage ?? null);

  for (const row of hydratedRows) {
    const resolved = resolveStateForRow(row, orderMap, seedMap);
    const normalizedLegacy = buildLegacyContentFromPublished({
      slug: resolved.slug,
      isStarter: resolved.isStarter,
      publishedDeleted: resolved.publishedDeleted,
      publishedPage: resolved.publishedPage
    });

    const missingDraftContent = row.draftContent === null && !resolved.draftDeleted;
    const missingPublishedContent = row.publishedContent === null && !resolved.publishedDeleted;
    const missingCatalogDraft = row.catalogDraft === null;
    const missingCatalogPublished = row.catalogPublished === null;

    const needsLegacySync = stableStringify(row.content) !== stableStringify(normalizedLegacy);
    const needsDeletedSync = row.draftDeleted !== resolved.draftDeleted || row.publishedDeleted !== resolved.publishedDeleted;
    const needsCatalogDraftSync = stableStringify(row.catalogDraft) !== stableStringify(resolved.draftCatalog);
    const needsCatalogPublishedSync = stableStringify(row.catalogPublished) !== stableStringify(resolved.publishedCatalog);

    if (
      missingDraftContent ||
      missingPublishedContent ||
      missingCatalogDraft ||
      missingCatalogPublished ||
      needsLegacySync ||
      needsDeletedSync ||
      needsCatalogDraftSync ||
      needsCatalogPublishedSync
    ) {
      await prisma.contentPage.update({
        where: { id: row.id },
        data: {
          draftContent: resolved.draftPage ? toJson(resolved.draftPage) : Prisma.JsonNull,
          publishedContent: resolved.publishedPage ? toJson(resolved.publishedPage) : Prisma.JsonNull,
          catalogDraft: toJson(resolved.draftCatalog),
          catalogPublished: toJson(resolved.publishedCatalog),
          draftDeleted: resolved.draftDeleted,
          publishedDeleted: resolved.publishedDeleted,
          content: toJson(normalizedLegacy)
        }
      });
    }
  }
}

async function loadResolvedAboutStates(): Promise<ResolvedAboutState[]> {
  await hydrateAboutV2Rows();

  const rows = (await prisma.contentPage.findMany({
    where: { scope },
    select: aboutRowSelect,
    orderBy: [{ slug: 'asc' }]
  })) as ContentPageRow[];

  const slugSet = new Set<string>(rows.map((row) => row.slug));
  for (const starterSlug of aboutPageSlugs) {
    slugSet.add(starterSlug);
  }

  const orderMap = defaultOrderMap(slugSet);
  const rowBySlug = new Map(rows.map((row) => [row.slug, row]));

  const aboutRow = rowBySlug.get('about') || null;
  const aboutPage = aboutRow
    ? parseStoredPage(getLegacyPublishedRaw(aboutRow), 'about') || getDefaultAboutPage('about')
    : getDefaultAboutPage('about');
  const seedMap = extractCardSeedBySlug(aboutPage ?? null);

  const states: ResolvedAboutState[] = [];
  for (const slug of slugSet) {
    const row = rowBySlug.get(slug) || null;
    if (row) {
      states.push(resolveStateForRow(row, orderMap, seedMap));
      continue;
    }

    states.push(resolveStateForMissingRow(slug, orderMap, seedMap));
  }

  return sortResolvedStates(states);
}

function buildAutoCardItems(states: ResolvedAboutState[], mode: 'draft' | 'published') {
  return states
    .filter((state) => state.slug !== 'about')
    .filter((state) => {
      const catalog = mode === 'draft' ? state.draftCatalog : state.publishedCatalog;
      return !catalog.deleted && catalog.enabled;
    })
    .sort((a, b) => {
      const catalogA = mode === 'draft' ? a.draftCatalog : a.publishedCatalog;
      const catalogB = mode === 'draft' ? b.draftCatalog : b.publishedCatalog;
      const orderDelta = catalogA.order - catalogB.order;
      if (orderDelta !== 0) return orderDelta;
      return a.slug.localeCompare(b.slug);
    })
    .map((state) => {
      const catalog = mode === 'draft' ? state.draftCatalog : state.publishedCatalog;
      return {
        hidden: false,
        title: catalog.cardTitle,
        description: catalog.cardDescription,
        href: publicPathForSlug(state.slug),
        image: catalog.cardImage
      };
    });
}

function syncAboutLandingCards(page: AboutPageContent, cards: ReturnType<typeof buildAutoCardItems>): AboutPageContent {
  const next = structuredClone(page);

  const firstLinkGridIndex = next.sections.findIndex((section) => section.type === 'linkGrid');
  if (firstLinkGridIndex >= 0) {
    const existing = next.sections[firstLinkGridIndex];
    if (existing.type === 'linkGrid') {
      next.sections[firstLinkGridIndex] = {
        ...existing,
        items: cards
      };
      return parseAboutPageContent(next);
    }
  }

  next.sections.splice(1, 0, {
    id: 'pathways',
    type: 'linkGrid',
    hidden: false,
    eyebrow: 'Find Your Place',
    heading: 'Get Involved',
    items: cards
  });

  return parseAboutPageContent(next);
}

const publicSubpagePhotoSections: Record<string, AboutPageContent['sections'][number]> = {
  performer: {
    id: 'performer-gallery',
    type: 'splitFeature',
    hidden: false,
    eyebrow: 'In Rehearsal',
    heading: 'Life in the Ensemble',
    lead:
      'From first read-through to closing night, performers grow through repetition, trust, and shared creative energy.',
    body: [
      'Students rehearse scenes, music, and choreography in a structured environment that balances challenge with support.',
      'Along the way, cast members build friendships and confidence that often carry far beyond the stage.'
    ],
    bullets: ['Scene study and character work', 'Vocal rehearsal and harmonies', 'Choreography and stage movement'],
    images: [
      {
        url: 'https://picsum.photos/seed/performer-gallery-1/900/1100',
        alt: 'Performer rehearsing under stage lights'
      },
      {
        url: 'https://picsum.photos/seed/performer-gallery-2/900/1100',
        alt: 'Cast rehearsal moment on stage'
      },
      {
        url: 'https://picsum.photos/seed/performer-gallery-3/900/1100',
        alt: 'Ensemble choreography rehearsal'
      }
    ],
    calloutTitle: 'A Supportive Process',
    calloutBody: 'Every rehearsal is designed to help students take creative risks while learning to work as one ensemble.'
  },
  'stage-crew': {
    id: 'stage-crew-gallery',
    type: 'splitFeature',
    hidden: false,
    eyebrow: 'Build Days',
    heading: 'Backstage in Motion',
    lead:
      'Stage Crew is hands-on and fast-paced, blending planning, construction, and timing during every production week.',
    body: [
      'Students collaborate on set pieces, organize prop tables, and practice transitions until every move is clean and safe.',
      'The work is practical, creative, and essential to keeping performances smooth from curtain up to final bow.'
    ],
    bullets: ['Set construction and paint calls', 'Prop tracking and reset discipline', 'Scene-change timing and safety'],
    images: [
      {
        url: 'https://picsum.photos/seed/stage-crew-gallery-1/900/1100',
        alt: 'Stage crew constructing scenic walls'
      },
      {
        url: 'https://picsum.photos/seed/stage-crew-gallery-2/900/1100',
        alt: 'Backstage prop organization before a show'
      },
      {
        url: 'https://picsum.photos/seed/stage-crew-gallery-3/900/1100',
        alt: 'Crew preparing for a scene transition'
      }
    ],
    calloutTitle: 'Team Coordination',
    calloutBody: 'Stage Crew members learn to communicate clearly and execute under live show pressure.'
  },
  'costume-crew': {
    id: 'costume-crew-gallery',
    type: 'splitFeature',
    hidden: false,
    eyebrow: 'Wardrobe Studio',
    heading: 'Style That Supports Story',
    lead:
      'Costume Crew blends creativity and practical detail, helping each performer step into character with confidence.',
    body: [
      'From sorting racks to quick-change planning, the costume team keeps garments organized, repaired, and performance-ready.',
      'Students learn fabric care, visual storytelling, and backstage timing while supporting every scene.'
    ],
    bullets: ['Character-based styling choices', 'Fitting and adjustment workflow', 'Quick-change planning during shows'],
    images: [
      {
        url: 'https://picsum.photos/seed/costume-crew-gallery-1/900/1100',
        alt: 'Costume rack arranged for production'
      },
      {
        url: 'https://picsum.photos/seed/costume-crew-gallery-2/900/1100',
        alt: 'Costume fitting and adjustment session'
      },
      {
        url: 'https://picsum.photos/seed/costume-crew-gallery-3/900/1100',
        alt: 'Wardrobe prep table before a performance'
      }
    ],
    calloutTitle: 'Precision and Creativity',
    calloutBody: 'Costume Crew members balance visual design with practical show needs in every rehearsal and performance.'
  }
};

const techCrewPhotoFallbacks: Array<{ url: string; alt: string }> = [
  {
    url: 'https://picsum.photos/seed/techbooth/1000/700',
    alt: 'Tech booth'
  },
  {
    url: 'https://picsum.photos/seed/techlights/1000/700',
    alt: 'Lighting rig and cue programming'
  },
  {
    url: 'https://picsum.photos/seed/techsound/1000/700',
    alt: 'Sound mixing board during rehearsal'
  }
];

function insertSectionBeforeCta(page: AboutPageContent, section: AboutPageContent['sections'][number]): AboutPageContent {
  if (page.sections.some((candidate) => candidate.id === section.id)) {
    return page;
  }

  const next = structuredClone(page);
  const ctaIndex = next.sections.findIndex((candidate) => candidate.type === 'cta');
  const insertIndex = ctaIndex >= 0 ? ctaIndex : next.sections.length;
  next.sections.splice(insertIndex, 0, section);
  return next;
}

function ensureTechCrewGalleryImages(page: AboutPageContent): AboutPageContent {
  const sectionIndex = page.sections.findIndex((section) => section.id === 'equipment' && section.type === 'splitFeature');
  if (sectionIndex < 0) {
    return page;
  }

  const next = structuredClone(page);
  const section = next.sections[sectionIndex];
  if (!section || section.type !== 'splitFeature') {
    return page;
  }

  const nextImages = section.images.slice(0, 4);
  const seenUrls = new Set(nextImages.map((image) => image.url));
  for (const fallback of techCrewPhotoFallbacks) {
    if (nextImages.length >= 4) break;
    if (seenUrls.has(fallback.url)) continue;
    nextImages.push(fallback);
    seenUrls.add(fallback.url);
  }

  section.images = nextImages;
  return next;
}

function applyPublicSubpagePhotoEnhancements(page: AboutPageContent): AboutPageContent {
  let next = page;
  const photoSection = publicSubpagePhotoSections[next.slug];
  if (photoSection) {
    next = insertSectionBeforeCta(next, photoSection);
  }

  if (next.slug === 'tech-crew') {
    next = ensureTechCrewGalleryImages(next);
  }

  if (next !== page) {
    return parseAboutPageContent(next);
  }

  return page;
}

function serializeAdminPage(state: ResolvedAboutState) {
  const fallbackPage = getDefaultAboutPage(state.slug) || buildTemplatePageForSlug(state.slug);
  const page = state.draftPage ?? fallbackPage;
  return {
    page,
    isCustomized: !state.isStarter || stableStringify(page) !== stableStringify(fallbackPage),
    updatedAt: state.draftUpdatedAt,
    updatedByAdminId: state.row?.updatedByAdminId ?? null
  };
}

function requireSlugState(states: ResolvedAboutState[], slug: string): ResolvedAboutState {
  const state = states.find((candidate) => candidate.slug === slug);
  if (!state) {
    throw new HttpError(404, 'About page not found');
  }
  return state;
}

export const aboutContentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/content/about/pages/:slug', async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    try {
      const row = (await prisma.contentPage.findUnique({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        select: aboutRowSelect
      })) as ContentPageRow | null;

      if (!row) {
        const defaultPage = getDefaultAboutPage(params.data.slug);
        if (defaultPage) {
          return reply.send(applyPublicSubpagePhotoEnhancements(defaultPage));
        }
        return reply.status(404).send({ error: 'About page not found' });
      }

      const rawPublished = getLegacyPublishedRaw(row);
      const isPublishedDeleted = row.publishedDeleted || isDeletedTombstone(rawPublished, row.slug);
      if (isPublishedDeleted) {
        return reply.status(404).send({ error: 'About page not found' });
      }

      const parsedPublished = parseStoredPage(rawPublished, row.slug);
      if (parsedPublished) {
        return reply.send(applyPublicSubpagePhotoEnhancements(parsedPublished));
      }

      const fallback = getDefaultAboutPage(params.data.slug);
      if (fallback) {
        request.log.warn({ scope, slug: params.data.slug }, 'Invalid stored About content encountered; serving defaults');
        return reply.send(applyPublicSubpagePhotoEnhancements(fallback));
      }

      return reply.status(404).send({ error: 'About page not found' });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        const defaultPage = getDefaultAboutPage(params.data.slug);
        if (defaultPage) {
          return reply.send(applyPublicSubpagePhotoEnhancements(defaultPage));
        }
        return reply.status(404).send({ error: 'About page not found' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load About content');
    }
  });

  app.get('/api/admin/about/v2/editor-state', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (_request, reply) => {
    try {
      const states = await loadResolvedAboutStates();
      reply.send(toEditorStatePayload(states));
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
        return;
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load About editor state');
    }
  });

  app.put('/api/admin/about/v2/draft/pages/:slug', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    const parsedBody = z.unknown().safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: 'Invalid page payload' });
    }

    let content: AboutPageContent;
    try {
      content = parseAboutPageContent(parsedBody.data);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Invalid About page content'
      });
    }

    if (content.slug !== params.data.slug) {
      return reply.status(400).send({ error: 'Page slug does not match the requested route' });
    }

    try {
      const states = await loadResolvedAboutStates();
      const current = requireSlugState(states, params.data.slug);

      if (containsImageDataUrl(content)) {
        if (!isR2Configured()) {
          throw new HttpError(503, 'R2/CDN is not configured. Configure R2 before saving image data URLs.');
        }
        content = await convertImageDataUrlsToR2(content, params.data.slug);
      }

      const nextDraftCatalog = {
        ...current.draftCatalog,
        deleted: false
      };

      const fallbackLegacy = buildLegacyContentFromPublished({
        slug: current.slug,
        isStarter: current.isStarter,
        publishedDeleted: current.publishedDeleted,
        publishedPage: current.publishedPage
      });

      const saved = await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        update: {
          title: buildAboutPageTitle(content),
          draftContent: toJson(content),
          draftDeleted: false,
          catalogDraft: toJson(nextDraftCatalog),
          content: toJson(fallbackLegacy),
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: params.data.slug,
          title: buildAboutPageTitle(content),
          content: toJson(fallbackLegacy),
          draftContent: toJson(content),
          publishedContent: current.publishedPage ? toJson(current.publishedPage) : Prisma.JsonNull,
          catalogDraft: toJson(nextDraftCatalog),
          catalogPublished: toJson(current.publishedCatalog),
          draftDeleted: false,
          publishedDeleted: current.publishedDeleted,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        select: {
          slug: true,
          updatedAt: true
        }
      });

      reply.send({
        slug: saved.slug,
        draftPage: content,
        draftUpdatedAt: saved.updatedAt.toISOString()
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to save About draft page');
    }
  });

  app.patch('/api/admin/about/v2/draft/catalog/:slug', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    const parsedPatch = catalogPatchSchema.safeParse(request.body ?? {});
    if (!parsedPatch.success) {
      return reply.status(400).send({ error: parsedPatch.error.issues[0]?.message ?? 'Invalid catalog patch' });
    }

    const patch = parsedPatch.data as AboutCatalogPatch;

    try {
      const states = await loadResolvedAboutStates();
      const current = requireSlugState(states, params.data.slug);

      let nextCatalog: AboutCatalogState = {
        ...current.draftCatalog,
        ...patch
      };

      nextCatalog = catalogStateSchema.parse(nextCatalog);
      if (nextCatalog.deleted) {
        nextCatalog.enabled = false;
      }

      if (nextCatalog.cardImage?.url && isImageDataUrl(nextCatalog.cardImage.url)) {
        if (!isR2Configured()) {
          throw new HttpError(503, 'R2/CDN is not configured. Configure R2 before saving image data URLs.');
        }
        nextCatalog = await convertCatalogImageDataUrlToR2(nextCatalog, params.data.slug);
      }

      const fallbackLegacy = buildLegacyContentFromPublished({
        slug: current.slug,
        isStarter: current.isStarter,
        publishedDeleted: current.publishedDeleted,
        publishedPage: current.publishedPage
      });

      const saved = await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        update: {
          catalogDraft: toJson(nextCatalog),
          draftDeleted: nextCatalog.deleted,
          content: toJson(fallbackLegacy),
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: params.data.slug,
          title: current.draftPage ? buildAboutPageTitle(current.draftPage) : titleFromSlug(params.data.slug),
          content: toJson(fallbackLegacy),
          draftContent: current.draftPage ? toJson(current.draftPage) : Prisma.JsonNull,
          publishedContent: current.publishedPage ? toJson(current.publishedPage) : Prisma.JsonNull,
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson(current.publishedCatalog),
          draftDeleted: nextCatalog.deleted,
          publishedDeleted: current.publishedDeleted,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        select: {
          slug: true,
          updatedAt: true
        }
      });

      reply.send({
        slug: saved.slug,
        draft: nextCatalog,
        draftDeleted: nextCatalog.deleted,
        draftUpdatedAt: saved.updatedAt.toISOString()
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to save About catalog draft');
    }
  });

  app.post('/api/admin/about/v2/draft/pages', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const parsed = createDraftPageSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid draft page payload' });
    }

    try {
      const states = await loadResolvedAboutStates();
      const existing = states.find((state) => state.slug === parsed.data.slug);
      if (existing && !existing.draftDeleted) {
        return reply.status(409).send({ error: 'A page with that slug already exists in draft state' });
      }

      const templateState = parsed.data.templateSlug
        ? states.find((state) => state.slug === parsed.data.templateSlug)
        : states.find((state) => state.slug === 'about');

      const templatePage =
        templateState?.draftPage ||
        templateState?.publishedPage ||
        getDefaultAboutPage(parsed.data.templateSlug ?? 'about') ||
        getDefaultAboutPage('about') ||
        listDefaultAboutPages()[0] ||
        buildTemplatePageForSlug(parsed.data.slug);

      const nextPage = structuredClone(templatePage);
      nextPage.slug = parsed.data.slug;
      nextPage.navLabel = titleFromSlug(parsed.data.slug);

      const maxOrder = Math.max(
        ...states
          .filter((state) => state.slug !== 'about')
          .map((state) => state.draftCatalog.order),
        0
      );

      const nextCatalog: AboutCatalogState = {
        enabled: true,
        order: maxOrder + 10,
        cardTitle: nextPage.navLabel,
        cardDescription: nextPage.hero.description,
        cardImage: undefined,
        deleted: false
      };

      const fallbackLegacy = existing
        ? buildLegacyContentFromPublished({
            slug: existing.slug,
            isStarter: existing.isStarter,
            publishedDeleted: existing.publishedDeleted,
            publishedPage: existing.publishedPage
          })
        : buildDeletedTombstone(parsed.data.slug, starterAboutSlugSet.has(parsed.data.slug));

      const saved = await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: parsed.data.slug
          }
        },
        update: {
          title: buildAboutPageTitle(nextPage),
          draftContent: toJson(nextPage),
          catalogDraft: toJson(nextCatalog),
          draftDeleted: false,
          content: toJson(fallbackLegacy),
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: parsed.data.slug,
          title: buildAboutPageTitle(nextPage),
          content: toJson(fallbackLegacy),
          draftContent: toJson(nextPage),
          publishedContent: Prisma.JsonNull,
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson({
            ...nextCatalog,
            enabled: false,
            deleted: true
          }),
          draftDeleted: false,
          publishedDeleted: true,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        select: {
          slug: true,
          updatedAt: true
        }
      });

      reply.status(201).send({
        slug: saved.slug,
        draftPage: nextPage,
        draftCatalog: nextCatalog,
        draftUpdatedAt: saved.updatedAt.toISOString()
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to create About draft page');
    }
  });

  app.delete('/api/admin/about/v2/draft/pages/:slug', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    try {
      const states = await loadResolvedAboutStates();
      const current = requireSlugState(states, params.data.slug);

      const nextCatalog: AboutCatalogState = {
        ...current.draftCatalog,
        enabled: false,
        deleted: true
      };

      const fallbackLegacy = buildLegacyContentFromPublished({
        slug: current.slug,
        isStarter: current.isStarter,
        publishedDeleted: current.publishedDeleted,
        publishedPage: current.publishedPage
      });

      await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        update: {
          draftDeleted: true,
          catalogDraft: toJson(nextCatalog),
          content: toJson(fallbackLegacy),
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: params.data.slug,
          title: current.publishedPage ? buildAboutPageTitle(current.publishedPage) : titleFromSlug(params.data.slug),
          content: toJson(fallbackLegacy),
          draftContent: current.draftPage ? toJson(current.draftPage) : Prisma.JsonNull,
          publishedContent: current.publishedPage ? toJson(current.publishedPage) : Prisma.JsonNull,
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson(current.publishedCatalog),
          draftDeleted: true,
          publishedDeleted: current.publishedDeleted,
          updatedByAdminId: request.adminUser?.id ?? null
        }
      });

      reply.send({
        success: true,
        slug: params.data.slug,
        draftDeleted: true
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to stage About draft deletion');
    }
  });

  app.post('/api/admin/about/v2/publish', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    try {
      const states = await loadResolvedAboutStates();

      await prisma.$transaction(async (tx) => {
        const draftBasedStates = states.map((state) => {
          const nextPublishedDeleted = state.draftDeleted || state.draftCatalog.deleted;
          const nextPublishedCatalog: AboutCatalogState = {
            ...state.draftCatalog,
            deleted: nextPublishedDeleted,
            enabled: nextPublishedDeleted ? false : state.draftCatalog.enabled
          };

          const fallbackPage = getDefaultAboutPage(state.slug) || buildTemplatePageForSlug(state.slug);
          const nextPublishedPage = nextPublishedDeleted
            ? null
            : state.draftPage || state.publishedPage || fallbackPage;

          return {
            ...state,
            nextPublishedDeleted,
            nextPublishedCatalog,
            nextPublishedPage
          };
        });

        const cards = buildAutoCardItems(
          draftBasedStates.map((state) => ({
            ...state,
            draftCatalog: state.nextPublishedCatalog,
            publishedCatalog: state.nextPublishedCatalog
          })),
          'draft'
        );

        const normalizedStates = draftBasedStates.map((state) => {
          if (state.slug !== 'about' || !state.nextPublishedPage || state.nextPublishedDeleted) {
            return state;
          }

          return {
            ...state,
            nextPublishedPage: syncAboutLandingCards(state.nextPublishedPage, cards)
          };
        });

        for (const state of normalizedStates) {
          const nextLegacy = buildLegacyContentFromPublished({
            slug: state.slug,
            isStarter: state.isStarter,
            publishedDeleted: state.nextPublishedDeleted,
            publishedPage: state.nextPublishedPage
          });

          await tx.contentPage.upsert({
            where: {
              scope_slug: {
                scope,
                slug: state.slug
              }
            },
            update: {
              title: state.nextPublishedPage
                ? buildAboutPageTitle(state.nextPublishedPage)
                : `Deleted About page: ${state.slug}`,
              content: toJson(nextLegacy),
              draftContent: state.nextPublishedPage ? toJson(state.nextPublishedPage) : Prisma.JsonNull,
              publishedContent: state.nextPublishedPage ? toJson(state.nextPublishedPage) : Prisma.JsonNull,
              catalogDraft: toJson(state.nextPublishedCatalog),
              catalogPublished: toJson(state.nextPublishedCatalog),
              draftDeleted: state.nextPublishedDeleted,
              publishedDeleted: state.nextPublishedDeleted,
              updatedByAdminId: request.adminUser?.id ?? null
            },
            create: {
              scope,
              slug: state.slug,
              title: state.nextPublishedPage
                ? buildAboutPageTitle(state.nextPublishedPage)
                : `Deleted About page: ${state.slug}`,
              content: toJson(nextLegacy),
              draftContent: state.nextPublishedPage ? toJson(state.nextPublishedPage) : Prisma.JsonNull,
              publishedContent: state.nextPublishedPage ? toJson(state.nextPublishedPage) : Prisma.JsonNull,
              catalogDraft: toJson(state.nextPublishedCatalog),
              catalogPublished: toJson(state.nextPublishedCatalog),
              draftDeleted: state.nextPublishedDeleted,
              publishedDeleted: state.nextPublishedDeleted,
              updatedByAdminId: request.adminUser?.id ?? null
            }
          });
        }
      });

      await logAudit({
        actor: request.adminUser?.username || 'super-admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'ABOUT_CONTENT_PUBLISHED_ALL',
        entityType: 'ContentPage',
        entityId: scope,
        metadata: {
          scope,
          publishedAt: new Date().toISOString()
        }
      });

      const nextStates = await loadResolvedAboutStates();
      reply.send({
        success: true,
        editorState: toEditorStatePayload(nextStates)
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to publish About drafts');
    }
  });

  app.post('/api/admin/about/v2/draft/reset', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const parsed = resetDraftSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid reset payload' });
    }

    try {
      const states = await loadResolvedAboutStates();
      const targetSlugs = parsed.data.slug ? [parsed.data.slug] : states.map((state) => state.slug);

      await prisma.$transaction(async (tx) => {
        for (const slug of targetSlugs) {
          const state = requireSlugState(states, slug);
          const fallbackPage = getDefaultAboutPage(slug) || buildTemplatePageForSlug(slug);
          const nextDraftPage = state.publishedDeleted ? null : state.publishedPage || fallbackPage;
          const nextDraftCatalog = state.publishedCatalog;

          const legacy = buildLegacyContentFromPublished({
            slug,
            isStarter: state.isStarter,
            publishedDeleted: state.publishedDeleted,
            publishedPage: state.publishedPage
          });

          await tx.contentPage.upsert({
            where: {
              scope_slug: {
                scope,
                slug
              }
            },
            update: {
              title: nextDraftPage ? buildAboutPageTitle(nextDraftPage) : `Deleted About page: ${slug}`,
              draftContent: nextDraftPage ? toJson(nextDraftPage) : Prisma.JsonNull,
              draftDeleted: state.publishedDeleted,
              catalogDraft: toJson(nextDraftCatalog),
              content: toJson(legacy),
              updatedByAdminId: request.adminUser?.id ?? null
            },
            create: {
              scope,
              slug,
              title: nextDraftPage ? buildAboutPageTitle(nextDraftPage) : `Deleted About page: ${slug}`,
              content: toJson(legacy),
              draftContent: nextDraftPage ? toJson(nextDraftPage) : Prisma.JsonNull,
              publishedContent: state.publishedPage ? toJson(state.publishedPage) : Prisma.JsonNull,
              catalogDraft: toJson(nextDraftCatalog),
              catalogPublished: toJson(state.publishedCatalog),
              draftDeleted: state.publishedDeleted,
              publishedDeleted: state.publishedDeleted,
              updatedByAdminId: request.adminUser?.id ?? null
            }
          });
        }
      });

      const nextStates = await loadResolvedAboutStates();
      reply.send({
        success: true,
        editorState: toEditorStatePayload(nextStates)
      });
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to reset About drafts');
    }
  });

  // v1 compatibility wrappers during rollout
  app.get('/api/admin/about/pages', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (_request, reply) => {
    try {
      const states = await loadResolvedAboutStates();
      const payload = states
        .filter((state) => !state.draftDeleted)
        .map((state) => serializeAdminPage(state));
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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load About editor');
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

      const states = await loadResolvedAboutStates();
      const current = requireSlugState(states, params.data.slug);
      const nextCatalog: AboutCatalogState = {
        ...current.draftCatalog,
        deleted: false
      };

      const saved = await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        update: {
          title: buildAboutPageTitle(content),
          content: toJson(content),
          draftContent: toJson(content),
          publishedContent: toJson(content),
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson(nextCatalog),
          draftDeleted: false,
          publishedDeleted: false,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: params.data.slug,
          title: buildAboutPageTitle(content),
          content: toJson(content),
          draftContent: toJson(content),
          publishedContent: toJson(content),
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson(nextCatalog),
          draftDeleted: false,
          publishedDeleted: false,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        select: {
          id: true,
          slug: true,
          title: true,
          content: true,
          draftContent: true,
          publishedContent: true,
          catalogDraft: true,
          catalogPublished: true,
          draftDeleted: true,
          publishedDeleted: true,
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

      const resolved = resolveStateForRow(saved as ContentPageRow, defaultOrderMap([saved.slug]), new Map());
      reply.send(serializeAdminPage(resolved));
    } catch (err) {
      if (isMissingContentPageTableError(err)) {
        return reply.status(503).send({ error: 'About content storage is not ready yet. Apply the latest database migration and restart the backend.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to save About content');
    }
  });

  app.delete('/api/admin/about/pages/:slug', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid about page slug' });
    }

    try {
      const states = await loadResolvedAboutStates();
      const current = requireSlugState(states, params.data.slug);

      const nextCatalog: AboutCatalogState = {
        ...current.publishedCatalog,
        enabled: false,
        deleted: true
      };

      const tombstone = buildDeletedTombstone(params.data.slug, current.isStarter);

      await prisma.contentPage.upsert({
        where: {
          scope_slug: {
            scope,
            slug: params.data.slug
          }
        },
        update: {
          title: `Deleted About page: ${params.data.slug}`,
          content: toJson(tombstone),
          draftContent: Prisma.JsonNull,
          publishedContent: Prisma.JsonNull,
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson(nextCatalog),
          draftDeleted: true,
          publishedDeleted: true,
          updatedByAdminId: request.adminUser?.id ?? null
        },
        create: {
          scope,
          slug: params.data.slug,
          title: `Deleted About page: ${params.data.slug}`,
          content: toJson(tombstone),
          draftContent: Prisma.JsonNull,
          publishedContent: Prisma.JsonNull,
          catalogDraft: toJson(nextCatalog),
          catalogPublished: toJson(nextCatalog),
          draftDeleted: true,
          publishedDeleted: true,
          updatedByAdminId: request.adminUser?.id ?? null
        }
      });

      await logAudit({
        actor: request.adminUser?.username || 'super-admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'ABOUT_CONTENT_DELETED',
        entityType: 'ContentPage',
        entityId: `${scope}:${params.data.slug}`,
        metadata: {
          scope,
          slug: params.data.slug
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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete About content');
    }
  });
};
