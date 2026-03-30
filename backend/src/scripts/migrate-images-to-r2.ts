import '../lib/load-env.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isImageDataUrl } from '../lib/image-data-url.js';
import { isR2Configured, uploadImageFromDataUrl } from '../lib/r2.js';

type Counters = {
  showsUpdated: number;
  castUpdated: number;
  contentPagesUpdated: number;
  contentImageUrlsUpdated: number;
  uploadsCreated: number;
  uploadsReused: number;
};

const uploadCache = new Map<string, string>();

async function convertDataUrlToR2(dataUrl: string, scope: string, filenameBase?: string): Promise<{ url: string; fromCache: boolean }> {
  const cached = uploadCache.get(dataUrl);
  if (cached) {
    return { url: cached, fromCache: true };
  }

  const uploaded = await uploadImageFromDataUrl({
    dataUrl,
    scope,
    filenameBase
  });

  uploadCache.set(dataUrl, uploaded.url);
  return { url: uploaded.url, fromCache: false };
}

async function migrateShows(counters: Counters): Promise<void> {
  const shows = await prisma.show.findMany({
    select: {
      id: true,
      title: true,
      posterUrl: true
    }
  });

  for (const show of shows) {
    if (!show.posterUrl || !isImageDataUrl(show.posterUrl)) {
      continue;
    }

    const converted = await convertDataUrlToR2(show.posterUrl, 'show-posters', show.title || show.id);
    if (converted.fromCache) counters.uploadsReused += 1;
    else counters.uploadsCreated += 1;

    await prisma.show.update({
      where: { id: show.id },
      data: { posterUrl: converted.url }
    });
    counters.showsUpdated += 1;
    console.log(`Updated show poster: ${show.id}`);
  }
}

async function migrateCast(counters: Counters): Promise<void> {
  const castMembers = await prisma.castMember.findMany({
    select: {
      id: true,
      name: true,
      photoUrl: true
    }
  });

  for (const member of castMembers) {
    if (!member.photoUrl || !isImageDataUrl(member.photoUrl)) {
      continue;
    }

    const converted = await convertDataUrlToR2(member.photoUrl, 'cast-photos', member.name || member.id);
    if (converted.fromCache) counters.uploadsReused += 1;
    else counters.uploadsCreated += 1;

    await prisma.castMember.update({
      where: { id: member.id },
      data: { photoUrl: converted.url }
    });
    counters.castUpdated += 1;
    console.log(`Updated cast photo: ${member.id}`);
  }
}

async function convertUnknownValue(value: unknown, filenameBasePrefix: string, counters: Counters): Promise<{ value: unknown; changed: number }> {
  if (typeof value === 'string') {
    if (!isImageDataUrl(value)) {
      return { value, changed: 0 };
    }

    const converted = await convertDataUrlToR2(value, 'about-content', filenameBasePrefix);
    if (converted.fromCache) counters.uploadsReused += 1;
    else counters.uploadsCreated += 1;

    return { value: converted.url, changed: 1 };
  }

  if (Array.isArray(value)) {
    let changed = 0;
    const next = [] as unknown[];
    for (let i = 0; i < value.length; i += 1) {
      const converted = await convertUnknownValue(value[i], `${filenameBasePrefix}-${i}`, counters);
      changed += converted.changed;
      next.push(converted.value);
    }
    return { value: next, changed };
  }

  if (value && typeof value === 'object') {
    let changed = 0;
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      const converted = await convertUnknownValue(nested, `${filenameBasePrefix}-${key}`, counters);
      changed += converted.changed;
      next[key] = converted.value;
    }
    return { value: next, changed };
  }

  return { value, changed: 0 };
}

async function migrateContentPages(counters: Counters): Promise<void> {
  const pages = await prisma.contentPage.findMany({
    select: {
      id: true,
      slug: true,
      content: true
    }
  });

  for (const page of pages) {
    const converted = await convertUnknownValue(page.content, `about-${page.slug}`, counters);
    if (converted.changed === 0) {
      continue;
    }

    await prisma.contentPage.update({
      where: { id: page.id },
      data: { content: converted.value as Prisma.InputJsonValue }
    });

    counters.contentPagesUpdated += 1;
    counters.contentImageUrlsUpdated += converted.changed;
    console.log(`Updated content page: ${page.slug} (${converted.changed} image URL(s))`);
  }
}

async function main(): Promise<void> {
  if (!isR2Configured()) {
    throw new Error('R2 is not fully configured. Set R2_* env vars before running this migration.');
  }

  const counters: Counters = {
    showsUpdated: 0,
    castUpdated: 0,
    contentPagesUpdated: 0,
    contentImageUrlsUpdated: 0,
    uploadsCreated: 0,
    uploadsReused: 0
  };

  await migrateShows(counters);
  await migrateCast(counters);
  await migrateContentPages(counters);

  console.log('');
  console.log('R2 migration complete');
  console.log(`- Shows updated: ${counters.showsUpdated}`);
  console.log(`- Cast members updated: ${counters.castUpdated}`);
  console.log(`- Content pages updated: ${counters.contentPagesUpdated}`);
  console.log(`- Content image URLs updated: ${counters.contentImageUrlsUpdated}`);
  console.log(`- Uploads created: ${counters.uploadsCreated}`);
  console.log(`- Uploads reused from cache: ${counters.uploadsReused}`);
}

main()
  .catch((err) => {
    console.error('R2 migration failed');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
