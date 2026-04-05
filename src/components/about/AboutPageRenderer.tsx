import { motion } from 'motion/react';
import { ArrowRight, CalendarDays, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import TheaterCalendar from '../TheaterCalendar';
import ShowHistorySlideshow from '../ShowHistorySlideshow';
import type {
  AboutAction,
  AboutCalendarSection,
  AboutCtaSection,
  AboutFeatureGridSection,
  AboutHistorySection,
  AboutLinkGridSection,
  AboutListPanelSection,
  AboutPageContent,
  AboutPeopleSection,
  AboutSection,
  AboutSplitFeatureSection,
  AboutStorySection,
  AboutTestimonialSection,
} from '../../lib/aboutContent';

// ─── Motion ───────────────────────────────────────────────────────────────────

type AboutRendererMode = 'public' | 'admin';

const fadeUp = (delay = 0, previewMode: AboutRendererMode = 'public') =>
  previewMode === 'admin'
    ? {
        initial: false,
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { opacity: 0, y: 18 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: '-50px' },
        transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] },
      };

// ─── Per-slug gradient strip (matches site nav strip) ─────────────────────────

const slugStrip: Record<string, string> = {
  about:                'from-red-700 via-red-600 to-amber-400',
  'musical-theater':    'from-red-700 via-amber-500 to-yellow-300',
  'tech-crew':          'from-red-700 via-red-500 to-stone-400',
  'set-design':         'from-amber-500 via-red-600 to-stone-900',
  'parents-association':'from-red-700 via-amber-400 to-yellow-300',
};

// ─── Shared atoms ─────────────────────────────────────────────────────────────

/** Matches the "PENNCREST HIGH SCHOOL THEATER" eyebrow label used site-wide */
function Eyebrow({ children, light = false }: { children: string; light?: boolean }) {
  return (
    <p
      className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] ${
        light ? 'text-red-400' : 'text-red-600'
      }`}
    >
      {children}
    </p>
  );
}

/** Matches the "Our Season" / "About the Theater Program" heading style */
function PageHeading({
  plain,
  accent,
  light = false,
}: {
  plain: string;
  accent?: string;
  light?: boolean;
}) {
  return (
    <h2
      className={`font-bold leading-[1.05] ${light ? 'text-white' : 'text-stone-900'}`}
      style={{
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: 'clamp(2rem, 4.5vw, 3.2rem)',
      }}
    >
      {plain}
      {accent && (
        <>
          {' '}
          <span className="text-red-700">{accent}</span>
        </>
      )}
    </h2>
  );
}

/** Inline section heading — smaller scale, same typeface */
function SectionHeading({
  eyebrow,
  heading,
  accentHeading = false,
  light = false,
  centered = false,
  className = '',
}: {
  eyebrow: string;
  heading: string;
  accentHeading?: boolean;
  light?: boolean;
  centered?: boolean;
  className?: string;
}) {
  return (
    <div className={`${centered ? 'text-center' : ''} ${className}`}>
      <Eyebrow light={light}>{eyebrow}</Eyebrow>
      <h2
        className={`font-bold leading-[1.08] ${light ? 'text-white' : 'text-stone-900'}`}
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 'clamp(1.6rem, 3vw, 2.5rem)',
        }}
      >
        {accentHeading ? <span className="text-red-700">{heading}</span> : heading}
      </h2>
    </div>
  );
}

/** Matches site's primary / ghost button style */
function ActionBtn({
  action,
  variant = 'solid',
  previewMode = 'public',
}: {
  action: AboutAction;
  variant?: 'solid' | 'ghost';
  previewMode?: AboutRendererMode;
}) {
  const isEmail = action.href.startsWith('mailto:');
  const isInternal = action.href.startsWith('/') && !action.href.startsWith('//');

  const solid =
    'group inline-flex items-center gap-2 rounded-full bg-red-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-800';
  const ghost =
    'group inline-flex items-center gap-2 rounded-full border border-stone-300 px-6 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100';

  const cls = variant === 'solid' ? solid : ghost;
  const icon = isEmail
    ? <Mail className="h-4 w-4 shrink-0" />
    : <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />;

  const inner = (
    <>
      <span>{action.label}</span>
      {icon}
    </>
  );

  if (previewMode === 'admin') {
    return <span className={`${cls} pointer-events-none`}>{inner}</span>;
  }

  return isInternal
    ? <Link to={action.href} className={cls}>{inner}</Link>
    : <a href={action.href} className={cls}>{inner}</a>;
}

// ─── Story ────────────────────────────────────────────────────────────────────

function renderStory(section: AboutStorySection, previewMode: AboutRendererMode) {
  const hasQuote = Boolean(section.quote?.trim());

  return (
    <section className="bg-stone-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} />

        <div className={`mt-10 grid gap-10 ${hasQuote ? 'lg:grid-cols-[1fr_1fr] lg:gap-16' : 'max-w-3xl'}`}>

          {hasQuote && (
            <motion.div {...fadeUp(0, previewMode)}>
              {/* Left-border quote block — matches site callout style */}
              <div className="border-l-4 border-red-700 pl-6">
                <p
                  className="font-bold leading-snug text-stone-900"
                  style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: 'clamp(1.15rem, 2.2vw, 1.5rem)',
                  }}
                >
                  &ldquo;{section.quote}&rdquo;
                </p>
                {section.quoteAttribution && (
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                    — {section.quoteAttribution}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          <motion.div {...fadeUp(hasQuote ? 0.08 : 0, previewMode)} className="space-y-4 text-[0.9375rem] leading-relaxed text-stone-600">
            {section.lead && (
              <p className="text-[1.05rem] font-semibold text-stone-800" style={{ fontFamily: 'Georgia, serif' }}>
                {section.lead}
              </p>
            )}
            {section.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          </motion.div>

        </div>
      </div>
    </section>
  );
}

// ─── Link Grid ────────────────────────────────────────────────────────────────

function renderLinkGrid(section: AboutLinkGridSection, previewMode: AboutRendererMode) {
  const visibleItems = section.items.filter((item) => item.hidden !== true);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {visibleItems.map((item, i) => (
            <motion.div key={i} {...fadeUp(i * 0.06, previewMode)}>
              {previewMode === 'admin' ? (
                <div className="group flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition duration-200">
                  <div className="overflow-hidden bg-stone-100">
                    {item.image?.url ? (
                      <img
                        src={item.image.url}
                        alt={item.image.alt}
                        className="aspect-[4/3] w-full object-cover"
                      />
                    ) : (
                      <div className="aspect-[4/3] w-full bg-gradient-to-br from-red-50 to-stone-100" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3
                      className="mb-1.5 font-bold text-stone-900"
                      style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}
                    >
                      {item.title}
                    </h3>
                    <p className="flex-1 text-sm leading-relaxed text-stone-500">{item.description}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-600">
                      Learn more
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              ) : (
                <Link
                  to={item.href}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                >
                <div className="overflow-hidden bg-stone-100">
                  {item.image?.url ? (
                    <img
                      src={item.image.url}
                      alt={item.image.alt}
                      className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="aspect-[4/3] w-full bg-gradient-to-br from-red-50 to-stone-100" />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3
                    className="mb-1.5 font-bold text-stone-900 transition group-hover:text-red-700"
                    style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}
                  >
                    {item.title}
                  </h3>
                  <p className="flex-1 text-sm leading-relaxed text-stone-500">{item.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-600">
                    Learn more
                    <ArrowRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </span>
                </div>
                </Link>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── People ───────────────────────────────────────────────────────────────────

function renderPeople(section: AboutPeopleSection, previewMode: AboutRendererMode) {
  return (
    <section className="bg-stone-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} />
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {section.items.map((person, i) => (
            <motion.article
              key={i}
              {...fadeUp(i * 0.07, previewMode)}
              className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
            >
              <div className="aspect-[4/3] overflow-hidden bg-stone-200">
                <img
                  src={person.image.url}
                  alt={person.image.alt || person.name}
                  className="h-full w-full object-cover transition duration-500 hover:scale-105"
                />
              </div>
              <div className="p-5">
                <h3
                  className="font-bold text-stone-900"
                  style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem' }}
                >
                  {person.name}
                </h3>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-600">
                  {person.role}
                </p>
                {person.bio && (
                  <p className="mt-3 text-sm leading-relaxed text-stone-500">{person.bio}</p>
                )}
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

function renderCalendar(section: AboutCalendarSection, previewMode: AboutRendererMode) {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} />
        {section.description && (
          <p className="mt-3 max-w-2xl text-[0.9375rem] text-stone-500">{section.description}</p>
        )}
        <motion.div {...fadeUp(0.07, previewMode)} className="mt-10">
          <TheaterCalendar />
        </motion.div>
      </div>
    </section>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function renderHistory(section: AboutHistorySection, previewMode: AboutRendererMode) {
  return (
    <section className="relative overflow-hidden border-t border-stone-800 bg-stone-900 py-16 text-white sm:py-20">
      {/* Subtle ambient glow — same as site's dark sections */}
      <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-red-900/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute bottom-0 left-0 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" aria-hidden />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} light />
        {section.description && (
          <p className="mt-3 max-w-2xl text-[0.9375rem] text-stone-300">{section.description}</p>
        )}
        <motion.div {...fadeUp(0.07, previewMode)} className="mt-10">
          <ShowHistorySlideshow items={section.items} />
        </motion.div>
      </div>
    </section>
  );
}

// ─── Feature Grid ─────────────────────────────────────────────────────────────

function renderFeatureGrid(section: AboutFeatureGridSection, previewMode: AboutRendererMode) {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} centered />
        {section.intro && (
          <p className="mx-auto mt-4 max-w-3xl text-center text-[0.9375rem] text-stone-500">
            {section.intro}
          </p>
        )}
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {section.items.map((item, i) => (
            <motion.div
              key={i}
              {...fadeUp(i * 0.065, previewMode)}
              className="rounded-2xl border border-stone-200 bg-stone-50 p-6 transition hover:border-red-100 hover:bg-white hover:shadow-md"
            >
              {/* Number — editorial detail that matches the site's playbill feel */}
              <p
                className="mb-3 text-[2rem] font-black leading-none text-stone-200 select-none"
                style={{ fontFamily: 'Georgia, serif' }}
                aria-hidden
              >
                {String(i + 1).padStart(2, '0')}
              </p>
              <h3
                className="mb-2 font-bold text-stone-900"
                style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}
              >
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-stone-500">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Split Feature ────────────────────────────────────────────────────────────

function renderSplitFeature(section: AboutSplitFeatureSection, previewMode: AboutRendererMode) {
  return (
    <section className="bg-stone-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">

          {/* Images */}
          <motion.div
            {...fadeUp(0, previewMode)}
            className={`grid gap-4 ${section.images.length > 1 ? 'grid-cols-2' : ''}`}
          >
            {section.images.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt={img.alt}
                className={`w-full rounded-2xl border border-stone-200 object-cover shadow-sm ${
                  section.images.length > 1 && i === 0 ? 'mt-8' : ''
                }`}
              />
            ))}
          </motion.div>

          {/* Text */}
          <motion.div {...fadeUp(0.08, previewMode)}>
            <SectionHeading eyebrow={section.eyebrow} heading={section.heading} />
            {section.lead && (
              <p
                className="mt-4 font-semibold text-stone-800"
                style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem' }}
              >
                {section.lead}
              </p>
            )}
            <div className="mt-4 space-y-3.5 text-[0.9375rem] leading-relaxed text-stone-600">
              {section.body.map((p, i) => <p key={i}>{p}</p>)}
            </div>
            {section.bullets.length > 0 && (
              <ul className="mt-5 space-y-2.5">
                {section.bullets.map((b, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm font-medium text-stone-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            )}
            {(section.calloutTitle || section.calloutBody) && (
              <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-5">
                {section.calloutTitle && (
                  <h3
                    className="font-bold text-stone-900"
                    style={{ fontFamily: 'Georgia, serif', fontSize: '1rem' }}
                  >
                    {section.calloutTitle}
                  </h3>
                )}
                {section.calloutBody && (
                  <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{section.calloutBody}</p>
                )}
              </div>
            )}
          </motion.div>

        </div>
      </div>
    </section>
  );
}

// ─── Testimonial ──────────────────────────────────────────────────────────────

function renderTestimonial(section: AboutTestimonialSection, previewMode: AboutRendererMode) {
  return (
    <section className="relative overflow-hidden bg-stone-900 py-16 text-white sm:py-20">
      <div className="pointer-events-none absolute left-1/3 top-0 h-80 w-80 rounded-full bg-red-900/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" aria-hidden />
      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-10 px-6 sm:px-10 lg:flex-row lg:items-center lg:gap-16">

        <motion.div {...fadeUp(0, previewMode)} className="flex-1">
          <SectionHeading eyebrow={section.eyebrow} heading={section.heading} light />
          <div className="mt-6 border-l-4 border-red-700 pl-5">
            <p className="text-[1.05rem] leading-relaxed text-stone-300">
              &ldquo;{section.quote}&rdquo;
            </p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              — {section.attribution}
            </p>
          </div>
        </motion.div>

        <motion.div {...fadeUp(0.09, previewMode)} className="mx-auto w-full max-w-xs flex-shrink-0 lg:w-64">
          <img
            src={section.image.url}
            alt={section.image.alt}
            className="aspect-[3/4] w-full rounded-2xl border border-stone-700 object-cover shadow-2xl"
          />
        </motion.div>

      </div>
    </section>
  );
}

// ─── List Panel ───────────────────────────────────────────────────────────────

function renderListPanel(section: AboutListPanelSection, previewMode: AboutRendererMode) {
  return (
    <section className="bg-stone-100 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6 sm:px-10">
        <div className="rounded-2xl border border-stone-200 bg-white p-8 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">

            <motion.div {...fadeUp(0, previewMode)}>
              <SectionHeading eyebrow={section.eyebrow} heading={section.heading} />
              {section.body && (
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-stone-600">{section.body}</p>
              )}
            </motion.div>

            <motion.div
              {...fadeUp(0.07, previewMode)}
              className="rounded-2xl border border-red-100 bg-red-50 p-6"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-red-700 shadow-sm">
                <CalendarDays className="h-4.5 w-4.5" />
              </div>
              <h3
                className="font-bold text-stone-900"
                style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}
              >
                {section.panelTitle}
              </h3>
              {section.panelBody && (
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{section.panelBody}</p>
              )}
              <ul className="mt-4 space-y-2.5">
                {section.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm font-medium text-stone-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

          </div>
        </div>
      </div>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function renderCta(section: AboutCtaSection, previewMode: AboutRendererMode) {
  return (
    <section className="border-t border-stone-100 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6 sm:px-10">
        <motion.div
          {...fadeUp(0, previewMode)}
          className="rounded-2xl border border-stone-200 bg-gradient-to-br from-orange-50 via-white to-red-50 p-8 sm:p-10"
        >
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h2
            className="max-w-3xl font-bold text-stone-900"
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 'clamp(1.6rem, 3vw, 2.5rem)',
              lineHeight: 1.1,
            }}
          >
            {section.heading}
          </h2>
          {section.body && (
            <p className="mt-3.5 max-w-2xl text-[0.9375rem] leading-relaxed text-stone-600">
              {section.body}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <ActionBtn action={section.primary} variant="solid" previewMode={previewMode} />
            {section.secondary && <ActionBtn action={section.secondary} variant="ghost" previewMode={previewMode} />}
          </div>
          {(section.contactLabel || section.contactValue) && (
            <p className="mt-5 text-sm text-stone-500">
              {section.contactLabel && (
                <span className="font-semibold text-stone-700">{section.contactLabel}: </span>
              )}
              {section.contactValue}
            </p>
          )}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function renderSection(section: AboutSection, previewMode: AboutRendererMode) {
  switch (section.type) {
    case 'story':        return renderStory(section, previewMode);
    case 'linkGrid':     return renderLinkGrid(section, previewMode);
    case 'people':       return renderPeople(section, previewMode);
    case 'calendar':     return renderCalendar(section, previewMode);
    case 'history':      return renderHistory(section, previewMode);
    case 'featureGrid':  return renderFeatureGrid(section, previewMode);
    case 'splitFeature': return renderSplitFeature(section, previewMode);
    case 'testimonial':  return renderTestimonial(section, previewMode);
    case 'listPanel':    return renderListPanel(section, previewMode);
    case 'cta':          return renderCta(section, previewMode);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function AboutPageRenderer({
  page,
  preview = false,
  previewMode,
}: {
  page: AboutPageContent;
  preview?: boolean;
  previewMode?: AboutRendererMode;
}) {
  const mode: AboutRendererMode = previewMode ?? (preview ? 'admin' : 'public');
  const strip = slugStrip[page.slug] ?? slugStrip.about;

  return (
    <div className={`overflow-hidden bg-white text-stone-900 ${preview ? 'rounded-2xl border border-stone-200' : ''}`}>

      {/* ── Hero — matches "Our Season" page header exactly ── */}
      <section className="relative overflow-hidden border-b border-stone-100 bg-white">
        {/* Thin gradient strip identical to site nav */}
        <div className={`absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r ${strip}`} aria-hidden />

        <div className="mx-auto max-w-7xl px-6 pb-12 pt-12 sm:px-10 sm:pb-14 sm:pt-14">
          <motion.p
            {...fadeUp(0, mode)}
            className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-red-600"
          >
            {page.hero.eyebrow}
          </motion.p>

          {/* Title split across two lines with red accent — matches site */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <motion.div {...fadeUp(0.05, mode)}>
              <h1
                className="font-bold leading-[0.97] text-stone-900"
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: 'clamp(2.8rem, 6.5vw, 5.5rem)',
                }}
              >
                {page.hero.title}
                {page.hero.accent && (
                  <>
                    <br />
                    <span className="text-red-700">{page.hero.accent}</span>
                  </>
                )}
              </h1>
            </motion.div>

            {page.hero.description && (
              <motion.p
                {...fadeUp(0.1, mode)}
                className="max-w-lg text-[0.9375rem] leading-relaxed text-stone-500 lg:text-right"
              >
                {page.hero.description}
              </motion.p>
            )}
          </div>
        </div>
      </section>

      {/* ── Content sections ── */}
      {page.sections
        .filter((section) => section.hidden !== true)
        .map((section) => (
          <div key={section.id}>{renderSection(section, mode)}</div>
        ))}

    </div>
  );
}
