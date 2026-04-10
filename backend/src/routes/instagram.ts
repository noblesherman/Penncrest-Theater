import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { env } from '../lib/env.js';
import { MemoryCache, type MemoryCacheEntry } from '../lib/memory-cache.js';
import {
  InstagramFeedServiceError,
  fetchInstagramFeedFromInstaloader,
  readInstagramFeedFromDisk,
  writeInstagramFeedToDisk,
  type InstagramFeedItem
} from '../services/instagram-feed.js';

type InstagramFeedResponse = {
  items: InstagramFeedItem[];
  stale: boolean;
  cached: boolean;
  fetchedAt: string | null;
};

type InstagramFeedCacheValue = {
  items: InstagramFeedItem[];
  fetchedAt: string;
};

const instagramFeedCache = new MemoryCache<InstagramFeedCacheValue>(
  env.NODE_ENV === 'test' ? 0 : env.INSTAGRAM_CACHE_TTL_SECONDS * 1000
);
let diskCacheBootstrapped = false;

function toFeedResponse(
  cacheEntry: MemoryCacheEntry<InstagramFeedCacheValue> | null,
  stale: boolean,
  cached: boolean
): InstagramFeedResponse {
  return {
    items: cacheEntry?.value.items ?? [],
    stale,
    cached,
    fetchedAt: cacheEntry?.value.fetchedAt ?? null
  };
}

async function bootstrapCacheFromDisk(app: FastifyInstance): Promise<void> {
  if (diskCacheBootstrapped) {
    return;
  }

  diskCacheBootstrapped = true;
  const persisted = await readInstagramFeedFromDisk();
  if (!persisted) {
    return;
  }

  const fetchedAtMs = Date.parse(persisted.fetchedAt);
  const now = Number.isNaN(fetchedAtMs) ? Date.now() : fetchedAtMs;
  instagramFeedCache.set(persisted, now);
  app.log.info(
    { fetchedAt: persisted.fetchedAt, count: persisted.items.length },
    'Loaded Instagram feed cache from disk'
  );
}

export const instagramRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/instagram/feed', async (_request, reply) => {
    await bootstrapCacheFromDisk(app);

    const freshCached = instagramFeedCache.getFresh();
    if (freshCached) {
      return reply.send(toFeedResponse(freshCached, false, true));
    }

    try {
      const snapshot = await fetchInstagramFeedFromInstaloader();
      const cacheEntry = instagramFeedCache.set(snapshot);

      try {
        await writeInstagramFeedToDisk(snapshot);
      } catch (persistErr) {
        app.log.warn({ err: persistErr }, 'Failed to persist Instagram feed cache to disk');
      }

      return reply.send(toFeedResponse(cacheEntry, false, false));
    } catch (err) {
      const staleCache = instagramFeedCache.getAny();
      if (staleCache) {
        app.log.warn({ err }, 'Instaloader fetch failed; serving stale cached response');
        return reply.send(toFeedResponse(staleCache, true, true));
      }

      const diskCache = await readInstagramFeedFromDisk();
      if (diskCache) {
        const cacheEntry = instagramFeedCache.set(diskCache, Date.parse(diskCache.fetchedAt) || Date.now());
        app.log.warn({ err }, 'Instaloader fetch failed; serving stale disk cache');
        return reply.send(toFeedResponse(cacheEntry, true, true));
      }

      if (err instanceof InstagramFeedServiceError && err.code === 'config') {
        app.log.warn({ err: err.message }, 'Instagram feed requested but Instaloader integration is not configured');
      } else {
        app.log.error({ err }, 'Instagram feed unavailable and no cache exists (Instaloader)');
      }

      return reply.status(503).send({
        error: 'Instagram feed is currently unavailable. Please try again later.'
      });
    }
  });
};
