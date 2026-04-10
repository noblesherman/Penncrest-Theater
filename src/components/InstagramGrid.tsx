import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import styles from './InstagramGrid.module.css';

type InstagramFeedItem = {
  id: string;
  shortcode: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  caption: string;
  permalink: string;
  timestamp: string;
};

type FeedResponse = {
  items?: unknown;
  stale?: unknown;
  cached?: unknown;
  fetchedAt?: unknown;
};

type InstagramGridProps = {
  title?: string;
  maxItems?: number;
};

const FALLBACK_CAPTION = 'View this post on Instagram';
const CLIENT_TIMEOUT_MS = 8_000;

function getMediaTypeBadge(mediaType: string): string | null {
  if (mediaType === 'VIDEO') {
    return 'Video';
  }

  if (mediaType === 'CAROUSEL_ALBUM') {
    return 'Carousel';
  }

  return null;
}

function normalizeFeedItem(value: unknown): InstagramFeedItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const shortcode = typeof raw.shortcode === 'string' ? raw.shortcode.trim() : '';
  const mediaType = typeof raw.mediaType === 'string' ? raw.mediaType.trim().toUpperCase() : '';
  const mediaUrl = typeof raw.mediaUrl === 'string' ? raw.mediaUrl.trim() : '';
  const thumbnailUrl = typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl.trim() : null;
  const caption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
  const permalink = typeof raw.permalink === 'string' ? raw.permalink.trim() : '';
  const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp.trim() : '';

  if (!id || !shortcode || !mediaType || !permalink || !timestamp) {
    return null;
  }

  if (!['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'].includes(mediaType)) {
    return null;
  }

  return {
    id,
    shortcode,
    mediaType,
    mediaUrl,
    thumbnailUrl: thumbnailUrl || null,
    caption,
    permalink,
    timestamp
  };
}

function normalizeFeedItems(value: unknown): InstagramFeedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeFeedItem).filter((item): item is InstagramFeedItem => item !== null);
}

export default function InstagramGrid({ title = 'From Instagram', maxItems = 12 }: InstagramGridProps) {
  const [items, setItems] = useState<InstagramFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    async function loadFeed() {
      if (active) {
        setIsLoading(true);
        setErrorMessage(null);
      }

      try {
        const response = await fetch(apiUrl('/api/instagram/feed'), {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          },
          signal: controller.signal
        });

        const payload = (await response.json().catch(() => null)) as FeedResponse | null;
        if (!response.ok || !payload) {
          throw new Error('Unable to load Instagram posts right now.');
        }

        const normalizedItems = normalizeFeedItems(payload.items);
        if (!active) return;
        setItems(normalizedItems.slice(0, Math.max(1, maxItems)));
        setIsStale(payload.stale === true);
      } catch (error) {
        if (!active) return;
        if (error instanceof Error && error.name === 'AbortError') {
          setErrorMessage('Instagram feed request timed out.');
        } else {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load Instagram posts right now.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
        window.clearTimeout(timeout);
      }
    }

    void loadFeed();

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [maxItems]);

  return (
    <section className={styles.section} aria-label="Instagram feed">
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {isStale && <p className={styles.meta}>Showing cached posts</p>}
      </div>

      {isLoading && (
        <div className={styles.grid} role="status" aria-live="polite" aria-label="Loading Instagram feed">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className={styles.skeletonCard} />
          ))}
        </div>
      )}

      {!isLoading && errorMessage && (
        <div className={styles.stateCard} role="status">
          <p className={styles.stateTitle}>Instagram feed unavailable</p>
          <p className={styles.stateText}>{errorMessage}</p>
        </div>
      )}

      {!isLoading && !errorMessage && items.length === 0 && (
        <div className={styles.stateCard} role="status">
          <p className={styles.stateTitle}>No Instagram posts yet</p>
          <p className={styles.stateText}>Check back soon for the latest updates from rehearsals and shows.</p>
        </div>
      )}

      {!isLoading && !errorMessage && items.length > 0 && (
        <div className={styles.grid}>
          {items.map((item) => {
            const badge = getMediaTypeBadge(item.mediaType);
            const previewImage = item.mediaType === 'VIDEO' ? item.thumbnailUrl || item.mediaUrl : item.mediaUrl || item.thumbnailUrl || '';
            return (
              <a
                key={item.id}
                href={item.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.card}
                aria-label={`Open Instagram post ${item.shortcode} in a new tab`}
              >
                <div className={styles.mediaWrap}>
                  {previewImage ? (
                    <img src={previewImage} alt={item.caption || FALLBACK_CAPTION} loading="lazy" className={styles.mediaImage} />
                  ) : (
                    <div className={styles.mediaFallback}>{FALLBACK_CAPTION}</div>
                  )}
                  {badge && <span className={styles.badge}>{badge}</span>}
                </div>
                <p className={styles.caption}>{item.caption || FALLBACK_CAPTION}</p>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
