export const SITE_NAME = 'Penncrest Theater';
export const SITE_SHORT_NAME = 'Penncrest';
export const SITE_DESCRIPTION =
  'Penncrest Theater is the Penncrest High School theater program in Media, Pennsylvania, featuring student productions, ticket sales, arts programs, and community events.';
export const SITE_FALLBACK_URL = 'https://www.penncresttheater.org';
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
  '/about',
  '/tech-crew',
  '/set-design',
  '/musical-theater',
  '/interest-meeting',
  '/fundraising'
] as const;
