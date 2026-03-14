import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { JsonLd } from '../lib/seo';
import { cleanText, resolveSiteUrl, toAbsoluteUrl, trimDescription } from '../lib/seo';
import { SITE_DESCRIPTION, SITE_NAME, SITE_SOCIAL_IMAGE_PATH } from '../lib/siteMeta';

type SeoProps = {
  title: string;
  description?: string;
  canonicalPath?: string;
  image?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  structuredData?: JsonLd;
  siteUrl?: string;
};

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

export default function Seo({
  title,
  description = SITE_DESCRIPTION,
  canonicalPath,
  image = SITE_SOCIAL_IMAGE_PATH,
  type = 'website',
  noindex = false,
  structuredData,
  siteUrl
}: SeoProps) {
  const location = useLocation();
  const siteOrigin = resolveSiteUrl(siteUrl);
  const canonicalUrl = toAbsoluteUrl(canonicalPath || location.pathname, siteOrigin);
  const imageUrl = toAbsoluteUrl(image, siteOrigin);
  const normalizedDescription = trimDescription(description);
  const normalizedTitle = cleanText(title);
  const robots = noindex
    ? 'noindex, nofollow, noarchive'
    : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
  const jsonLd = structuredData ? JSON.stringify(structuredData) : '';

  useEffect(() => {
    document.title = normalizedTitle;
    document.documentElement.lang = 'en';

    upsertMeta('name', 'description', normalizedDescription);
    upsertMeta('name', 'robots', robots);
    upsertMeta('name', 'googlebot', robots);
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', normalizedTitle);
    upsertMeta('name', 'twitter:description', normalizedDescription);
    upsertMeta('name', 'twitter:image', imageUrl);
    upsertMeta('property', 'og:locale', 'en_US');
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('property', 'og:title', normalizedTitle);
    upsertMeta('property', 'og:description', normalizedDescription);
    upsertMeta('property', 'og:url', canonicalUrl);
    upsertMeta('property', 'og:image', imageUrl);
    upsertMeta('property', 'og:image:alt', `${SITE_NAME} social preview`);
    upsertLink('canonical', canonicalUrl);

    const scriptId = 'route-json-ld';
    const existingScript = document.getElementById(scriptId);
    if (jsonLd) {
      const script = existingScript || document.createElement('script');
      script.id = scriptId;
      script.setAttribute('type', 'application/ld+json');
      script.textContent = jsonLd;
      if (!existingScript) {
        document.head.appendChild(script);
      }
    } else if (existingScript) {
      existingScript.remove();
    }
  }, [canonicalUrl, imageUrl, jsonLd, normalizedDescription, normalizedTitle, robots, type]);

  return null;
}
