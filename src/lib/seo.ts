/*
Handoff note for Mr. Smith:
- File: `src/lib/seo.ts`
- What this is: Frontend shared helper module.
- What it does: Holds reusable client logic, types, and config used across the web app.
- Connections: Imported by pages/components and often mirrors backend contracts.
- Main content type: Logic/config/data-shaping (not page layout).
- Safe edits here: Additive helpers and text constants.
- Be careful with: Changing exported behavior/types that many files consume.
- Useful context: If a bug appears across multiple pages, this shared layer is a likely source.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import {
  SITE_ADDRESS,
  SITE_DESCRIPTION,
  SITE_FALLBACK_URL,
  SITE_NAME,
  SITE_SOCIAL_IMAGE_PATH
} from './siteMeta';

export type JsonLd =
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

type BreadcrumbItem = {
  name: string;
  path: string;
};

type SiteUrlResolutionOptions = {
  preferWindowOriginForLocalDev?: boolean;
};

export function normalizeSiteUrl(url: string | null | undefined): string {
  if (typeof url !== 'string') {
    return '';
  }
  return url.replace(/\/+$/, '');
}

function coerceAbsoluteSiteUrl(url?: string): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return normalizeSiteUrl(new URL(trimmed).toString());
  } catch {
    try {
      return normalizeSiteUrl(new URL(`https://${trimmed}`).toString());
    } catch {
      return null;
    }
  }
}

function isVercelAppHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

export function resolveSiteUrl(explicitSiteUrl?: string): string {
  const fallbackUrl = normalizeSiteUrl(SITE_FALLBACK_URL);
  const normalizedExplicitSiteUrl = coerceAbsoluteSiteUrl(explicitSiteUrl);
  if (normalizedExplicitSiteUrl && !isVercelAppHost(normalizedExplicitSiteUrl)) {
    return normalizedExplicitSiteUrl;
  }

  const envSiteUrl = coerceAbsoluteSiteUrl(import.meta.env.VITE_SITE_URL);
  if (envSiteUrl && !isVercelAppHost(envSiteUrl)) {
    return envSiteUrl;
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    const windowSiteUrl = normalizeSiteUrl(window.location.origin);
    if (windowSiteUrl && !isVercelAppHost(windowSiteUrl)) {
      return windowSiteUrl;
    }
  }

  return fallbackUrl;
}

function isLocalDevHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.trycloudflare.com')
  );
}

export function resolveCanonicalFrontendOrigin(
  explicitSiteUrl?: string,
  options?: SiteUrlResolutionOptions
): string {
  const preferWindowOriginForLocalDev = options?.preferWindowOriginForLocalDev ?? true;

  if (preferWindowOriginForLocalDev && typeof window !== 'undefined' && window.location.origin) {
    try {
      const parsedWindowOrigin = new URL(window.location.origin);
      if (isLocalDevHostname(parsedWindowOrigin.hostname)) {
        return parsedWindowOrigin.origin;
      }
    } catch {
    }
  }

  try {
    return new URL(resolveSiteUrl(explicitSiteUrl)).origin;
  } catch {
    if (typeof window !== 'undefined' && window.location.origin) {
      return window.location.origin;
    }

    return new URL(SITE_FALLBACK_URL).origin;
  }
}

export function toCanonicalFrontendUrl(
  pathOrUrl: string,
  explicitSiteUrl?: string,
  options?: SiteUrlResolutionOptions
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const origin = resolveCanonicalFrontendOrigin(explicitSiteUrl, options);
  return new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, `${origin}/`).toString();
}

export function toAbsoluteUrl(pathOrUrl: string, explicitSiteUrl?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const siteUrl = resolveSiteUrl(explicitSiteUrl);
  return new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, `${siteUrl}/`).toString();
}

export function cleanText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function trimDescription(value: string | null | undefined, maxLength = 160): string {
  const normalized = cleanText(value);
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength - 1);
  const breakpoint = truncated.lastIndexOf(' ');
  const safe = breakpoint > 80 ? truncated.slice(0, breakpoint) : truncated;
  return `${safe.trimEnd()}…`;
}

export function buildOrganizationSchema(explicitSiteUrl?: string): Record<string, unknown> {
  const siteUrl = resolveSiteUrl(explicitSiteUrl);

  return {
    '@context': 'https://schema.org',
    '@type': 'PerformingGroup',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: siteUrl,
    logo: toAbsoluteUrl(SITE_SOCIAL_IMAGE_PATH, siteUrl),
    email: 'mailto:jsmith3@rtmsd.org',
    address: {
      '@type': 'PostalAddress',
      ...SITE_ADDRESS
    }
  };
}

export function buildWebsiteSchema(explicitSiteUrl?: string): Record<string, unknown> {
  const siteUrl = resolveSiteUrl(explicitSiteUrl);

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: siteUrl
  };
}

export function buildWebPageSchema(
  title: string,
  description: string,
  path: string,
  type: 'WebPage' | 'CollectionPage' | 'AboutPage' = 'WebPage',
  explicitSiteUrl?: string
): Record<string, unknown> {
  const siteUrl = resolveSiteUrl(explicitSiteUrl);
  const pageUrl = toAbsoluteUrl(path, siteUrl);

  return {
    '@context': 'https://schema.org',
    '@type': type,
    name: title,
    description,
    url: pageUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: siteUrl
    },
    about: {
      '@type': 'PerformingGroup',
      name: SITE_NAME,
      url: siteUrl
    }
  };
}

export function buildBreadcrumbSchema(items: BreadcrumbItem[], explicitSiteUrl?: string): Record<string, unknown> {
  const siteUrl = resolveSiteUrl(explicitSiteUrl);

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.path, siteUrl)
    }))
  };
}
