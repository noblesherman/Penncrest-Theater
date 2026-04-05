export const ABOUT_PAGE_SLUGS = [
  'about',
  'performer',
  'stage-crew',
  'musical-theater',
  'tech-crew',
  'costume-crew',
  'set-design'
] as const;

export type AboutPageSlug = string;

export type AboutImage = {
  url: string;
  alt: string;
};

export type AboutAction = {
  label: string;
  href: string;
};

export type AboutHero = {
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
};

export type AboutStorySection = {
  id: string;
  hidden?: boolean;
  type: 'story';
  eyebrow: string;
  heading: string;
  lead: string;
  paragraphs: string[];
  quote?: string;
  quoteAttribution?: string;
};

export type AboutLinkGridSection = {
  id: string;
  hidden?: boolean;
  type: 'linkGrid';
  eyebrow: string;
  heading: string;
  items: Array<{
    hidden?: boolean;
    title: string;
    description: string;
    href: string;
    image?: AboutImage;
  }>;
};

export type AboutPeopleSection = {
  id: string;
  hidden?: boolean;
  type: 'people';
  eyebrow: string;
  heading: string;
  items: Array<{
    name: string;
    role: string;
    image: AboutImage;
    bio?: string;
  }>;
};

export type AboutCalendarSection = {
  id: string;
  hidden?: boolean;
  type: 'calendar';
  eyebrow: string;
  heading: string;
  description: string;
  calendarUrl: string;
};

export type AboutHistoryItem = {
  year: string;
  title: string;
  description: string;
  image: AboutImage;
};

export type AboutHistorySection = {
  id: string;
  hidden?: boolean;
  type: 'history';
  eyebrow: string;
  heading: string;
  description: string;
  items: AboutHistoryItem[];
};

export type AboutFeatureGridSection = {
  id: string;
  hidden?: boolean;
  type: 'featureGrid';
  eyebrow: string;
  heading: string;
  intro: string;
  items: Array<{
    title: string;
    description: string;
  }>;
};

export type AboutSplitFeatureSection = {
  id: string;
  hidden?: boolean;
  type: 'splitFeature';
  eyebrow: string;
  heading: string;
  lead: string;
  body: string[];
  bullets: string[];
  images: AboutImage[];
  calloutTitle?: string;
  calloutBody?: string;
};

export type AboutTestimonialSection = {
  id: string;
  hidden?: boolean;
  type: 'testimonial';
  eyebrow: string;
  heading: string;
  quote: string;
  attribution: string;
  image: AboutImage;
};

export type AboutListPanelSection = {
  id: string;
  hidden?: boolean;
  type: 'listPanel';
  eyebrow: string;
  heading: string;
  body: string;
  panelTitle: string;
  panelBody: string;
  items: string[];
};

export type AboutCtaSection = {
  id: string;
  hidden?: boolean;
  type: 'cta';
  eyebrow: string;
  heading: string;
  body: string;
  primary: AboutAction;
  secondary?: AboutAction;
  contactLabel?: string;
  contactValue?: string;
};

export type AboutSection =
  | AboutStorySection
  | AboutLinkGridSection
  | AboutPeopleSection
  | AboutCalendarSection
  | AboutHistorySection
  | AboutFeatureGridSection
  | AboutSplitFeatureSection
  | AboutTestimonialSection
  | AboutListPanelSection
  | AboutCtaSection;

export type AboutPageContent = {
  slug: AboutPageSlug;
  navLabel: string;
  hero: AboutHero;
  sections: AboutSection[];
};

export type AdminAboutPageRecord = {
  page: AboutPageContent;
  isCustomized: boolean;
  updatedAt: string | null;
  updatedByAdminId: string | null;
};

export type AboutCatalogState = {
  enabled: boolean;
  order: number;
  cardTitle: string;
  cardDescription: string;
  cardImage?: AboutImage;
  deleted: boolean;
};

export type AboutCatalogEntry = {
  slug: AboutPageSlug;
  isStarter: boolean;
  publicPath: string;
  draft: AboutCatalogState;
  published: AboutCatalogState;
  changed: boolean;
};

export type AboutDraftDeltaSummary = {
  totalChanged: number;
  changedPages: number;
  changedCatalog: number;
  stagedDeletions: number;
};

export type AdminAboutEditorPageState = {
  slug: AboutPageSlug;
  isStarter: boolean;
  draftPage: AboutPageContent | null;
  publishedPage: AboutPageContent | null;
  draftDeleted: boolean;
  publishedDeleted: boolean;
  draftUpdatedAt: string | null;
  publishedUpdatedAt: string | null;
  pageChanged: boolean;
};

export type AdminAboutEditorState = {
  pages: AdminAboutEditorPageState[];
  catalog: AboutCatalogEntry[];
  defaults: AboutPageContent[];
  draftDelta: AboutDraftDeltaSummary;
};

export const ABOUT_PAGE_LABELS: Record<AboutPageSlug, string> = {
  about: 'About Landing',
  performer: 'Performer',
  'stage-crew': 'Stage Crew',
  'musical-theater': 'Musical Theater',
  'tech-crew': 'Tech Crew',
  'costume-crew': 'Costume Crew',
  'set-design': 'Set Design'
};

export function cloneAboutPage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
