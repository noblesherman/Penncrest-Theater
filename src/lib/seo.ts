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

export function normalizeSiteUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveSiteUrl(explicitSiteUrl?: string): string {
  if (explicitSiteUrl) {
    return normalizeSiteUrl(explicitSiteUrl);
  }

  const envSiteUrl = import.meta.env.VITE_SITE_URL?.trim();
  if (envSiteUrl) {
    return normalizeSiteUrl(envSiteUrl);
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return normalizeSiteUrl(window.location.origin);
  }

  return SITE_FALLBACK_URL;
}

export function toAbsoluteUrl(pathOrUrl: string, explicitSiteUrl?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const siteUrl = resolveSiteUrl(explicitSiteUrl);
  return new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, `${siteUrl}/`).toString();
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function trimDescription(value: string, maxLength = 160): string {
  const normalized = cleanText(value);
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
