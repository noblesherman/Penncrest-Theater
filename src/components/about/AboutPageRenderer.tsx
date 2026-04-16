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
        transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as any },
      };

// ─── Per-slug gradient strip (matches site nav strip) ─────────────────────────

const slugStrip: Record<string, string> = {
  about:                'from-red-700 via-red-600 to-amber-400',
  'musical-theater':    'from-red-700 via-amber-500 to-yellow-300',
  'tech-crew':          'from-red-700 via-red-500 to-stone-400',
  'set-design':         'from-amber-500 via-red-600 to-stone-900',
  'parents-association':'from-red-700 via-amber-400 to-yellow-300',
};

const splitFeatureGalleryOnlyIds = new Set([
  'performer-gallery',
  'stage-crew-gallery',
  'costume-crew-gallery',
  'tech-crew-gallery',
  'equipment'
]);

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
  previewMode = 'public',
}: {
  eyebrow: string;
  heading: string;
  accentHeading?: boolean;
  light?: boolean;
  centered?: boolean;
  className?: string;
  previewMode?: AboutRendererMode;
}) {
  return (
    <div className={`${centered ? 'text-center' : ''} ${className}`}>
      <Eyebrow light={light}>{eyebrow}</Eyebrow>
      <h2
        className={`font-bold leading-[1.08] ${light ? 'text-white' : 'text-stone-900'}`}
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize:
            previewMode === 'admin'
              ? '2rem'
              : 'clamp(1.6rem, 3vw, 2.5rem)',
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
    'group inline-flex items-center gap-2 rounded-[24px] bg-red-700 px-7 py-3 text-sm font-semibold text-white shadow-md transition-all duration-300 hover:bg-red-800 hover:-translate-y-1 hover:shadow-lg hover:ring-[3px] hover:ring-red-700/30';
  const ghost =
    'group inline-flex items-center gap-2 rounded-[24px] px-7 py-3 text-sm font-semibold text-stone-700 ring-1 ring-inset ring-stone-300/80 transition-all duration-300 hover:bg-stone-50 hover:-translate-y-1 hover:shadow-md hover:ring-stone-400 hover:text-stone-900 bg-white/50 backdrop-blur-md';

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
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} previewMode={previewMode} />

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
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
                    — {section.quoteAttribution}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          <motion.div {...fadeUp(hasQuote ? 0.08 : 0, previewMode)} className="space-y-4 text-base leading-relaxed text-stone-600">
            {section.lead && (
              <p className="text-[1.125rem] font-semibold text-stone-800" style={{ fontFamily: 'Georgia, serif' }}>
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
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} previewMode={previewMode} />
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
                  className="group relative flex h-full flex-col overflow-hidden rounded-[24px] border border-stone-200/80 bg-white/90 backdrop-blur-md transition-all duration-500 hover:-translate-y-2 hover:border-red-200 hover:shadow-[0_20px_40px_-15px_rgba(220,38,38,0.15)]"
                >
                <div className="overflow-hidden bg-stone-100 relative">
                  {item.image?.url ? (
                    <img
                      src={item.image.url}
                      alt={item.image.alt}
                      className="aspect-[4/3] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                    />
                  ) : (
                    <div className="aspect-[4/3] w-full bg-gradient-to-br from-red-50 to-stone-100 transition-transform duration-700 ease-out group-hover:scale-110" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-red-950/20 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3
                    className="mb-1.5 font-bold text-stone-900 transition-colors duration-300 group-hover:text-red-700"
                    style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem' }}
                  >
                    {item.title}
                  </h3>
                  <p className="flex-1 text-sm leading-relaxed text-stone-500 transition-colors duration-300 group-hover:text-stone-600">{item.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-600">
                    Learn more
                    <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" />
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
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} previewMode={previewMode} />
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {section.items.map((person, i) => (
            <motion.article
              key={i}
              {...fadeUp(i * 0.07, previewMode)}
              className="group overflow-hidden rounded-[24px] border border-stone-200/80 bg-white/90 backdrop-blur-sm transition-all duration-500 hover:-translate-y-2 hover:border-red-200 hover:shadow-[0_20px_40px_-15px_rgba(220,38,38,0.15)]"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-stone-200">
                <img
                  src={person.image.url}
                  alt={person.image.alt || person.name}
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                />
                <div className="absolute inset-0 transition-colors duration-500 group-hover:bg-red-950/10" />
              </div>
              <div className="relative p-6">
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-red-100/60 blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 pointer-events-none" />
                <h3
                  className="font-bold text-stone-900 transition-colors duration-300 group-hover:text-red-950"
                  style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem' }}
                >
                  {person.name}
                </h3>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-600 transition-colors duration-300 group-hover:text-red-700">
                  {person.role}
                </p>
                {person.bio && (
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-stone-500 transition-colors duration-300 group-hover:text-stone-600">{person.bio}</p>
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
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} previewMode={previewMode} />
        {section.description && (
          <p className="mt-3 max-w-2xl text-[0.9375rem] text-stone-500">{section.description}</p>
        )}
        <motion.div {...fadeUp(0.07, previewMode)} className="mt-10">
          <TheaterCalendar calendarUrl={section.calendarUrl} />
        </motion.div>
      </div>
    </section>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function renderHistory(section: AboutHistorySection, previewMode: AboutRendererMode) {
  return (
    <section id={section.id} className="relative overflow-hidden border-t border-stone-800 bg-stone-900 py-16 text-white sm:py-20">
      {/* Subtle ambient glow — same as site's dark sections */}
      <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-red-900/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute bottom-0 left-0 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" aria-hidden />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} light previewMode={previewMode} />
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
  const gridColsClass = section.id === 'roles'
    ? 'mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4'
    : 'mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3';

  return (
    <section className="bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading eyebrow={section.eyebrow} heading={section.heading} centered previewMode={previewMode} />
        {section.intro && (
          <p className="mx-auto mt-4 max-w-3xl text-center text-[0.9375rem] text-stone-500">
            {section.intro}
          </p>
        )}
        <div className={gridColsClass}>
          {section.items.map((item, i) => (
            <motion.div
              key={i}
              {...fadeUp(i * 0.065, previewMode)}
              className="group relative overflow-hidden rounded-[24px] border border-stone-200/80 bg-stone-50/50 p-8 transition-all duration-500 hover:-translate-y-2 hover:border-red-200 hover:bg-white hover:shadow-[0_20px_40px_-15px_rgba(220,38,38,0.15)]"
            >
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-red-100/50 blur-3xl transition-opacity duration-500 group-hover:opacity-100 opacity-0" />
              {/* Number — editorial detail that matches the site's playbill feel */}
              <p
                className="mb-4 text-[2.5rem] font-black leading-none text-stone-200/80 select-none transition-all duration-500 group-hover:-translate-y-1 group-hover:text-red-100"
                style={{ fontFamily: 'Georgia, serif' }}
                aria-hidden
              >
                {String(i + 1).padStart(2, '0')}
              </p>
              <h3
                className="mb-2.5 font-bold text-stone-900 transition-colors duration-300 group-hover:text-red-950"
                style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem' }}
              >
                {item.title}
              </h3>
              <p className="text-[0.9375rem] leading-relaxed text-stone-500 transition-colors duration-300 group-hover:text-stone-600">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Split Feature ────────────────────────────────────────────────────────────

function renderSplitFeature(section: AboutSplitFeatureSection, previewMode: AboutRendererMode) {
  if (splitFeatureGalleryOnlyIds.has(section.id)) {
    const isPerformerGallery = section.id === 'performer-gallery';
    const isStageGallery = section.id === 'stage-crew-gallery';
    const isCostumeGallery = section.id === 'costume-crew-gallery';

    const performerImages = isPerformerGallery ? section.images.slice(0, 6) : section.images;
    const performerDesktopCaptions = [
      'Voice warmup',
      'Blocking rehearsal',
      'Choreography pass',
      'Scene run',
      'Tech rehearsal',
      'Performance notes'
    ];
    const performerLayoutClasses = [
      'lg:col-span-3 lg:row-span-2',
      'lg:col-span-5 lg:row-span-2',
      'lg:col-span-4 lg:row-span-2',
      'lg:col-span-5 lg:row-span-2',
      'lg:col-span-4 lg:row-span-2',
      'lg:col-span-3 lg:row-span-2'
    ];

    const gridClass = isPerformerGallery
      ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:auto-rows-[136px]'
      : isCostumeGallery
        ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mx-auto lg:max-w-3xl'
        : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

    const performerFrameClasses = [
      '',
      '',
      '',
      '',
      '',
      ''
    ];

    const stageFrameClasses = [
      'sm:translate-y-4 sm:-rotate-[1deg]',
      'sm:-translate-y-1 sm:rotate-[0.8deg]',
      'sm:translate-y-2 sm:-rotate-[0.7deg]'
    ];

    const costumeFrameClasses = [
      'sm:translate-y-1 sm:-rotate-[0.5deg]',
      'sm:-translate-y-1 sm:rotate-[0.5deg]'
    ];

    const techFrameClasses = [
      'sm:translate-y-5 sm:-rotate-[1.4deg]',
      'sm:-translate-y-1 sm:rotate-[1deg]',
      'sm:translate-y-3 sm:-rotate-[0.8deg]',
      'sm:-translate-y-2 sm:rotate-[1.2deg]'
    ];

    const frameClasses = isPerformerGallery
      ? performerFrameClasses
      : isStageGallery
        ? stageFrameClasses
        : isCostumeGallery
          ? costumeFrameClasses
          : techFrameClasses;

    const imageAspectClass = isPerformerGallery
      ? 'h-full'
      : isCostumeGallery
        ? 'aspect-[3/4]'
        : 'aspect-[4/5]';

    const mobileSlideSeconds = isPerformerGallery ? 2.6 : isCostumeGallery ? 2.8 : 2.5;
    const mobileRepeatDelay = Math.max(0, (performerImages.length - 1) * mobileSlideSeconds);
    const mobileStageClass = isPerformerGallery
      ? 'h-[min(84vw,34rem)] max-w-[30rem]'
      : isCostumeGallery
        ? 'h-[min(78vw,30rem)] max-w-[24rem]'
        : 'h-[min(74vw,28rem)] max-w-[26rem]';
    const galleryShellClass = isPerformerGallery
      ? 'mx-auto w-full max-w-none px-3 sm:px-6 lg:px-8'
      : 'mx-auto max-w-7xl px-6 sm:px-10';
    const desktopGridClass = `${gridClass} hidden sm:grid w-full rounded-[32px] border border-stone-200/60 bg-white/80 p-6 shadow-xl backdrop-blur-xl ring-1 ring-black/5`;

    return (
      <section className="bg-stone-50 py-16 sm:py-20">
        <div className={galleryShellClass}>
          <motion.div
            {...fadeUp(0, previewMode)}
            className="sm:hidden"
          >
            <div className={`relative mx-auto w-full ${mobileStageClass}`}>
              {performerImages.map((img, i) => {
                const isFirst = i === 0;

                return (
                  <motion.figure
                    key={i}
                    className="absolute inset-0 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
                    initial={isFirst
                      ? { opacity: 1, rotateY: 0, scale: 1, y: 0 }
                      : { opacity: 0, rotateY: -12, scale: 0.97, y: 8 }}
                    animate={isFirst
                      ? {
                          opacity: [1, 1, 0, 0],
                          rotateY: [0, 0, 10, 10],
                          scale: [1, 1, 0.985, 0.985],
                          y: [0, 0, -4, -4]
                        }
                      : {
                          opacity: [0, 1, 1, 0],
                          rotateY: [-12, 0, 0, 10],
                          scale: [0.97, 1, 1, 0.985],
                          y: [8, 0, 0, -4]
                        }}
                    transition={{
                      duration: mobileSlideSeconds,
                      times: [0, 0.18, 0.78, 1],
                      delay: i * mobileSlideSeconds,
                      repeat: Infinity,
                      repeatDelay: mobileRepeatDelay,
                      ease: [0.22, 1, 0.36, 1]
                    }}
                    style={{ transformPerspective: 1100 }}
                  >
                    <img
                      src={img.url}
                      alt={img.alt}
                      className="h-full w-full object-cover"
                    />
                  </motion.figure>
                );
              })}

              <div className="pointer-events-none absolute inset-x-6 bottom-3 h-12 rounded-full bg-gradient-to-t from-black/10 to-transparent" aria-hidden />
            </div>
          </motion.div>

          <motion.div
            {...fadeUp(0, previewMode)}
            className={desktopGridClass}
          >
            {performerImages.map((img, i) => (
              <figure
                key={i}
                className={`group relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-all duration-500 hover:z-10 hover:scale-[1.03] hover:shadow-xl ${
                  performerImages.length > 1 ? frameClasses[i % frameClasses.length] : ''
                } ${
                  isPerformerGallery ? performerLayoutClasses[i % performerLayoutClasses.length] : ''
                } ${
                  isPerformerGallery ? 'h-full' : ''
                }`}
              >
                <img
                  src={img.url}
                  alt={img.alt}
                  className={`${imageAspectClass} w-full object-cover transition-transform duration-700 group-hover:scale-110`}
                />
                  <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-4 flex-col justify-end bg-gradient-to-t from-stone-900/80 via-stone-900/30 to-transparent px-5 pb-5 pt-20 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                    <span className="text-[12px] font-bold uppercase tracking-[0.15em] text-white drop-shadow-md">
                      {isPerformerGallery ? (performerDesktopCaptions[i] ?? img.alt) : img.alt}
                    </span>
                  </figcaption>
              </figure>
            ))}
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-stone-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">

          {/* Images */}
          <motion.div
            {...fadeUp(0, previewMode)}
            className={`grid gap-4 relative group ${section.images.length > 1 ? 'grid-cols-2' : ''}`}
          >
            <div className="absolute -inset-4 bg-red-50/40 rounded-3xl blur-3xl opacity-0 transition-opacity duration-700 group-hover:opacity-100 mix-blend-multiply pointer-events-none" />
            {section.images.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt={img.alt}
                className={`w-full rounded-[24px] border border-stone-200/80 object-cover shadow-lg transition-all duration-700 relative z-10 hover:scale-[1.02] hover:shadow-2xl ${
                  section.images.length > 1 && i === 0 ? 'mt-8' : ''
                }`}
              />
            ))}
          </motion.div>

          {/* Text */}
          <motion.div {...fadeUp(0.08, previewMode)}>
            <SectionHeading eyebrow={section.eyebrow} heading={section.heading} previewMode={previewMode} />
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
          <SectionHeading eyebrow={section.eyebrow} heading={section.heading} light previewMode={previewMode} />
          <div className="mt-6 border-l-4 border-red-700 pl-5">
            <p className="text-[1.05rem] leading-relaxed text-stone-300">
              &ldquo;{section.quote}&rdquo;
            </p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              — {section.attribution}
            </p>
          </div>
        </motion.div>

        <motion.div {...fadeUp(0.09, previewMode)} className="group mx-auto w-full max-w-xs flex-shrink-0 lg:w-64 relative">
          <div className="absolute -inset-4 bg-amber-500/20 rounded-full blur-2xl opacity-0 transition-opacity duration-700 group-hover:opacity-100 pointer-events-none" />
          <img
            src={section.image.url}
            alt={section.image.alt}
            className="aspect-[3/4] w-full rounded-[24px] border border-stone-700/80 object-cover shadow-2xl relative z-10 transition-transform duration-700 group-hover:scale-[1.03] group-hover:-rotate-1"
          />
        </motion.div>

      </div>
    </section>
  );
}

// ─── List Panel ───────────────────────────────────────────────────────────────

function renderListPanel(section: AboutListPanelSection, previewMode: AboutRendererMode) {
  return (
    <section className="bg-stone-50 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6 sm:px-10">
        <div className="rounded-[32px] border border-stone-200/80 bg-white/80 backdrop-blur-xl p-8 sm:p-12 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-red-100">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start relative">
            
            <div className="absolute top-0 right-0 -mr-8 -mt-8 h-48 w-48 rounded-full bg-red-50/60 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

            <motion.div {...fadeUp(0, previewMode)} className="relative z-10">
              <SectionHeading eyebrow={section.eyebrow} heading={section.heading} previewMode={previewMode} />
              {section.body && (
                <p className="mt-5 text-[0.95rem] leading-relaxed text-stone-600">{section.body}</p>
              )}
            </motion.div>

            <motion.div
              {...fadeUp(0.07, previewMode)}
              className="rounded-[24px] border border-red-100/50 bg-gradient-to-br from-red-50/50 to-red-50/10 p-8 shadow-inner"
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
          className="group relative overflow-hidden rounded-[32px] border border-stone-200/60 bg-gradient-to-br from-orange-50/80 via-white/90 to-red-50/80 p-8 sm:p-12 shadow-xl backdrop-blur-xl transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(220,38,38,0.2)] hover:border-red-200"
        >
          <div className="absolute -left-32 -top-32 h-64 w-64 rounded-full bg-red-100/50 blur-3xl transition-opacity duration-700 group-hover:opacity-100 opacity-0 pointer-events-none" />
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

        <div className="mx-auto max-w-7xl px-6 pb-6 pt-12 sm:px-10 sm:pb-8 sm:pt-14">
          <motion.p
            {...fadeUp(0, mode)}
            className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-red-600"
          >
            {page.hero.eyebrow}
          </motion.p>

          {/* Title split across two lines with red accent — matches site */}
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <motion.div {...fadeUp(0.05, mode)} className="lg:w-1/2">
              <h1
                className={`font-bold leading-[0.97] text-stone-900 ${mode === 'admin' ? 'break-words' : ''}`}
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize:
                    mode === 'admin'
                      ? '4rem'
                      : 'clamp(2.8rem, 6.5vw, 5.5rem)',
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
                className="max-w-lg text-[1.05rem] leading-relaxed text-stone-600 lg:w-1/2"
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
