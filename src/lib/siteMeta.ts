/*
Handoff note for Mr. Smith:
- File: `src/lib/siteMeta.ts`
- What this is: Frontend shared helper module.
- What it does: Holds reusable client logic, types, and config used across the web app.
- Connections: Imported by pages/components and often mirrors backend contracts.
- Main content type: Logic/config/data-shaping (not page layout).
- Safe edits here: Additive helpers and text constants.
- Be careful with: Changing exported behavior/types that many files consume.
- Useful context: If a bug appears across multiple pages, this shared layer is a likely source.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

export const SITE_NAME = 'Penncrest Theater';
export const SITE_SHORT_NAME = 'Penncrest';
export const SITE_DESCRIPTION =
  'Penncrest Theater is the Penncrest High School theater program in Media, Pennsylvania, featuring student productions, ticket sales, arts programs, and community events.';
export const SITE_FALLBACK_URL = 'https://www.penncresttheater.com';
export const SITE_EMAIL = 'jsmith3@rtmsd.org';
export const SITE_PHONE = '';
export const SITE_SOCIAL_IMAGE_PATH = '/og-image.svg';
export const SITE_FAVICON_PATH = '/favicon.svg';

export const SITE_ADDRESS = {
  streetAddress: '134 Barren Rd',
  addressLocality: 'Media',
  addressRegion: 'PA',
  postalCode: '19063',
  addressCountry: 'US'
} as const;

export const INDEXABLE_STATIC_ROUTES = [
  '/',
  '/shows',
  '/shows/community-events',
  '/about',
  '/performer',
  '/stage-crew',
  '/tech-crew',
  '/costume-crew',
  '/set-design',
  '/musical-theater',
  '/interest-meeting',
  '/fundraising',
  '/privacy-policy',
  '/terms-of-service',
  '/refund-policy'
] as const;
