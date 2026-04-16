import {
  type ChangeEvent, type ReactNode,
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, Check,
  CheckCircle2, ChevronDown, ChevronUp, ExternalLink,
  Eye, EyeOff, FilePenLine, ImagePlus, Link2, Loader2,
  Plus, RefreshCw, RotateCcw, Save, Trash2, Upload, X,
} from 'lucide-react';
import AboutPageRenderer from '../../components/about/AboutPageRenderer';
import { adminFetch } from '../../lib/adminAuth';
import {
  ABOUT_PAGE_LABELS, ABOUT_PAGE_SLUGS, cloneAboutPage,
  type AboutCatalogState, type AdminAboutEditorPageState,
  type AdminAboutEditorState, type AboutAction, type AboutCalendarSection, type AboutCtaSection,
  type AboutFeatureGridSection, type AboutHistoryItem, type AboutHistorySection,
  type AboutImage, type AboutLinkGridSection, type AboutListPanelSection,
  type AboutPageContent, type AboutPageSlug, type AboutPeopleSection,
  type AboutSection, type AboutSplitFeatureSection, type AboutStorySection,
  type AboutTestimonialSection,
} from '../../lib/aboutContent';

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTER_PUBLIC_PATHS: Record<string, string> = {
  about: '/about',
  performer: '/performer',
  'stage-crew': '/stage-crew',
  'musical-theater': '/musical-theater',
  'tech-crew': '/tech-crew',
  'costume-crew': '/costume-crew',
  'set-design': '/set-design',
};

const SECTION_TYPE_LABELS: Record<string, string> = {
  story: 'Story Block',
  linkGrid: 'Linked Cards',
  people: 'People Grid',
  calendar: 'Calendar Embed',
  history: 'History Timeline',
  featureGrid: 'Feature Grid',
  splitFeature: 'Split Feature',
  testimonial: 'Testimonial',
  listPanel: 'List Panel',
  cta: 'Call to Action',
};

const SUBPAGE_GALLERY_SECTION_IDS = new Set([
  'performer-gallery',
  'stage-crew-gallery',
  'costume-crew-gallery',
  'tech-crew-gallery',
]);

const REQUIRED_GALLERY_SECTION_IDS_BY_SLUG: Record<string, string[]> = {
  performer: ['performer-gallery'],
  'stage-crew': ['stage-crew-gallery'],
  'costume-crew': ['costume-crew-gallery'],
  'tech-crew': ['equipment'],
};

const ADDABLE_SECTION_TYPES = Object.keys(SECTION_TYPE_LABELS) as Array<keyof typeof SECTION_TYPE_LABELS>;

function publicPathForSlug(slug: string): string {
  return STARTER_PUBLIC_PATHS[slug] ?? `/${slug}`;
}

function labelFromSlug(slug: string): string {
  return (
    slug
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
      .trim() || 'About Page'
  );
}

function normalizeSlugInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function newSectionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isSubpageGallerySection(slug: string, section: AboutSection): boolean {
  if (section.type !== 'splitFeature') return false;
  if (section.id === 'equipment') return slug === 'tech-crew';
  return SUBPAGE_GALLERY_SECTION_IDS.has(section.id);
}

function insertSectionBeforeCta(page: AboutPageContent, section: AboutSection): AboutPageContent {
  if (page.sections.some((candidate) => candidate.id === section.id)) {
    return page;
  }

  const next = cloneAboutPage(page);
  const ctaIndex = next.sections.findIndex((candidate) => candidate.type === 'cta');
  const insertIndex = ctaIndex >= 0 ? ctaIndex : next.sections.length;
  next.sections.splice(insertIndex, 0, cloneAboutPage(section));
  return next;
}

function ensureAdminSubpageGallerySections(
  page: AboutPageContent,
  defaultsBySlug: Record<string, AboutPageContent>
): AboutPageContent {
  const requiredSectionIds = REQUIRED_GALLERY_SECTION_IDS_BY_SLUG[page.slug] ?? [];
  if (requiredSectionIds.length === 0) return page;

  const defaultPage = defaultsBySlug[page.slug];
  if (!defaultPage) return page;

  let next = page;
  for (const sectionId of requiredSectionIds) {
    const existingSection = next.sections.find((section) => section.id === sectionId);
    if (existingSection?.type === 'splitFeature') {
      continue;
    }

    const defaultSection = defaultPage.sections.find(
      (section): section is AboutSplitFeatureSection => section.id === sectionId && section.type === 'splitFeature'
    );
    if (!defaultSection) {
      continue;
    }

    next = insertSectionBeforeCta(next, defaultSection);
  }

  return next;
}

function makeBlankSection(type: string): AboutSection {
  const id = newSectionId();
  const base = { id, hidden: false, eyebrow: '', heading: '' };
  switch (type) {
    case 'story':
      return { ...base, type: 'story', lead: '', paragraphs: [] };
    case 'linkGrid':
      return { ...base, type: 'linkGrid', items: [] };
    case 'people':
      return { ...base, type: 'people', items: [] };
    case 'calendar':
      return { ...base, type: 'calendar', description: '', calendarUrl: '' };
    case 'history':
      return { ...base, type: 'history', description: '', items: [] };
    case 'featureGrid':
      return { ...base, type: 'featureGrid', intro: '', items: [] };
    case 'splitFeature':
      return { ...base, type: 'splitFeature', lead: '', body: [], bullets: [], images: [] };
    case 'testimonial':
      return { ...base, type: 'testimonial', quote: '', attribution: '', image: { url: '', alt: '' } };
    case 'listPanel':
      return { ...base, type: 'listPanel', body: '', panelTitle: '', panelBody: '', items: [] };
    case 'cta':
      return { ...base, type: 'cta', body: '', primary: { label: '', href: '' } };
    default:
      return { ...base, type: 'story', lead: '', paragraphs: [] };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('We hit a small backstage snag while trying to read file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('We hit a small backstage snag while trying to parse image.'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('We hit a small backstage snag while trying to load image.'));
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas error.')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, mime === 'image/png' ? undefined : 0.84));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatUpdatedAt(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function reorder<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 placeholder:text-zinc-400 bg-white';
const taClass = `${inputClass} min-h-[88px] resize-y`;

function FieldLabel({ children, changed = false }: { children: ReactNode; changed?: boolean }) {
  return (
    <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
      <span>{children}</span>
      {changed && (
        <span
          title="Has unpublished changes"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 ring-1 ring-amber-200/80"
        />
      )}
    </p>
  );
}

function Field({ label, children, changed = false }: { label: string; children: ReactNode; changed?: boolean }) {
  return (
    <div>
      <FieldLabel changed={changed}>{label}</FieldLabel>
      {children}
    </div>
  );
}

function Row2({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function IconBtn({
  onClick, disabled, title, variant = 'neutral', children,
}: {
  onClick: () => void; disabled?: boolean; title?: string;
  variant?: 'neutral' | 'danger'; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        variant === 'danger'
          ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
          : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-50"
    >
      {children}
    </button>
  );
}

function ReorderControls({
  index, length, onMove, onRemove, disabled = false,
}: {
  index: number; length: number;
  onMove: (d: -1 | 1) => void; onRemove: () => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <IconBtn onClick={() => onMove(-1)} disabled={disabled || index === 0} title="Move up">
        <ArrowUp className="h-3.5 w-3.5" />
      </IconBtn>
      <IconBtn onClick={() => onMove(1)} disabled={disabled || index === length - 1} title="Move down">
        <ArrowDown className="h-3.5 w-3.5" />
      </IconBtn>
      <IconBtn onClick={onRemove} disabled={disabled} variant="danger" title="Remove">
        <Trash2 className="h-3.5 w-3.5" />
      </IconBtn>
    </div>
  );
}

// ─── Image field ──────────────────────────────────────────────────────────────

function ImageField({
  label, value, onChange, optional, disabled,
}: {
  label: string; value?: AboutImage;
  onChange: (v: AboutImage | undefined) => void;
  optional?: boolean; disabled?: boolean;
}) {
  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    onChange({ url: await fileToDataUrl(file, 1600, 1600), alt: value?.alt ?? '' });
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        {optional && value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={disabled}
            className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40"
          >
            <X className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {value?.url
            ? <img src={value.url} alt={value.alt} className="h-full w-full object-cover" />
            : (
              <div className="flex h-full items-center justify-center text-zinc-300">
                <ImagePlus className="h-5 w-5" />
              </div>
            )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={value?.url ?? ''}
            onChange={(e) => onChange({ url: e.target.value, alt: value?.alt ?? '' })}
            disabled={disabled}
            placeholder="Image URL or upload →"
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <input
              value={value?.alt ?? ''}
              onChange={(e) => onChange({ url: value?.url ?? '', alt: e.target.value })}
              disabled={disabled}
              placeholder="Alt text"
              className={inputClass}
            />
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
              <Upload className="h-3.5 w-3.5" /> Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onUpload(e)}
                disabled={disabled}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Action field ─────────────────────────────────────────────────────────────

function ActionField({
  label, value, onChange, onRemove, disabled,
}: {
  label: string; value?: AboutAction;
  onChange: (v: AboutAction) => void;
  onRemove?: () => void; disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40"
          >
            <X className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
      <Row2>
        <Field label="Button label">
          <input
            value={value?.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value, href: value?.href ?? '' })}
            disabled={disabled}
            placeholder="e.g. Learn More"
            className={inputClass}
          />
        </Field>
        <Field label="URL">
          <input
            value={value?.href ?? ''}
            onChange={(e) => onChange({ label: value?.label ?? '', href: e.target.value })}
            disabled={disabled}
            placeholder="/about or mailto:…"
            className={inputClass}
          />
        </Field>
      </Row2>
    </div>
  );
}

// ─── String list ──────────────────────────────────────────────────────────────

function StringList({
  label, values, onChange, addLabel, disabled, placeholder,
}: {
  label: string; values: string[];
  onChange: (v: string[]) => void;
  addLabel: string; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <button
          type="button"
          onClick={() => onChange([...values, ''])}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
      </div>
      {values.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 py-3 text-center text-xs text-zinc-400">
          No items yet — add one above
        </p>
      ) : (
        <div className="space-y-2">
          {values.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={v}
                onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
                disabled={disabled}
                placeholder={placeholder ?? `Item ${i + 1}`}
                className={`${inputClass} flex-1`}
              />
              <ReorderControls
                index={i}
                length={values.length}
                disabled={disabled}
                onMove={(d) => onChange(reorder(values, i, d))}
                onRemove={() => onChange(values.filter((_, j) => j !== i))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Collapsible section shell ────────────────────────────────────────────────

function SectionShell({
  id, index, label, hidden, onToggleHidden,
  onMoveUp, onMoveDown, onRemove, isFirst, isLast, changed = false, gallerySection = false, children,
}: {
  id: string; index: number; label: string;
  hidden: boolean; onToggleHidden: () => void;
  onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
  isFirst: boolean; isLast: boolean; changed?: boolean; gallerySection?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-3 text-left min-w-0"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
            {index}
          </span>
          <span className="flex-1 min-w-0 text-sm font-semibold text-zinc-900 truncate">{label}</span>
          {changed && (
            <span
              title="Has unpublished changes"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 ring-1 ring-amber-200/80"
            />
          )}
          {gallerySection && (
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Gallery Section
            </span>
          )}
          {hidden && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Hidden
            </span>
          )}
          {open
            ? <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />}
        </button>

        <div className="flex items-center gap-1 pl-1 shrink-0">
          <button
            type="button"
            onClick={onToggleHidden}
            title={hidden ? 'Show section' : 'Hide section'}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              hidden
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'
            }`}
          >
            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{hidden ? 'Show' : 'Hide'}</span>
          </button>
          <IconBtn onClick={onMoveUp} disabled={isFirst} title="Move section up">
            <ArrowUp className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onMoveDown} disabled={isLast} title="Move section down">
            <ArrowDown className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onRemove} variant="danger" title="Remove section">
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-100 px-4 py-4 space-y-4 bg-zinc-50/50">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Sub-item card ────────────────────────────────────────────────────────────

function SubItem({
  title, index, length, onMove, onRemove, children,
}: {
  title: string; index: number; length: number;
  onMove: (d: -1 | 1) => void; onRemove: () => void; children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2.5">
        <p className="text-xs font-semibold text-zinc-500 truncate">{title}</p>
        <ReorderControls index={index} length={length} onMove={onMove} onRemove={onRemove} />
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

// ─── Add Section picker ───────────────────────────────────────────────────────

function AddSectionPicker({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-50"
      >
        <Plus className="h-4 w-4" /> Add section
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden">
          {ADDABLE_SECTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => { onAdd(type); setOpen(false); }}
              className="flex w-full items-center px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 text-left"
            >
              {SECTION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Types for page editor state ─────────────────────────────────────────────

type PageEditorState = {
  /** What's currently in the form fields — only changes on user edits */
  local: AboutPageContent;
  /** Last version successfully auto-saved to the server */
  serverDraft: AboutPageContent;
  /** Last published version (null = never published or deleted live) */
  published: AboutPageContent | null;
  /** Whether a staged-delete draft exists */
  draftDeleted: boolean;
  publishedDeleted: boolean;
  draftUpdatedAt: string | null;
  publishedUpdatedAt: string | null;
  isStarter: boolean;
};

type CatalogEditorState = {
  local: AboutCatalogState;
  server: AboutCatalogState;
  published: AboutCatalogState;
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminAboutControlPage() {
  const [pages, setPages] = useState<Record<string, PageEditorState> | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, CatalogEditorState> | null>(null);
  const [defaults, setDefaults] = useState<Record<string, AboutPageContent> | null>(null);

  const [slug, setSlug] = useState<string>('about');
  const [newPageSlug, setNewPageSlug] = useState('');
  const [newPageTemplate, setNewPageTemplate] = useState('about');
  const [renameInput, setRenameInput] = useState('about');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('mobile');
  const [showCalendarInstructions, setShowCalendarInstructions] = useState(false);
  const mobilePreviewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Track which slugs are currently being auto-saved so we don't double-fire
  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Load ──────────────────────────────────────────────────────────────────

  const applyEditorState = (state: AdminAboutEditorState) => {
    const nextDefaults: Record<string, AboutPageContent> = {};
    state.defaults.forEach((p) => { nextDefaults[p.slug] = cloneAboutPage(p); });

    const nextPages: Record<string, PageEditorState> = {};
    state.pages.forEach((ps) => {
      if (ps.publishedDeleted) {
        return;
      }
      const fallback = nextDefaults[ps.slug] ?? nextDefaults['about'] ?? Object.values(nextDefaults)[0];
      const source = ps.draftPage ?? ps.publishedPage ?? (fallback ? cloneAboutPage(fallback) : null);
      if (!source) return;
      const normalized = cloneAboutPage(source);
      normalized.slug = ps.slug;
      if (!normalized.navLabel?.trim()) normalized.navLabel = labelFromSlug(ps.slug);
      const normalizedWithGalleries = ensureAdminSubpageGallerySections(normalized, nextDefaults);

      const published = ps.publishedPage
        ? ensureAdminSubpageGallerySections(cloneAboutPage(ps.publishedPage), nextDefaults)
        : null;

      nextPages[ps.slug] = {
        local: cloneAboutPage(normalizedWithGalleries),
        serverDraft: cloneAboutPage(normalizedWithGalleries),
        published,
        draftDeleted: ps.draftDeleted ?? false,
        publishedDeleted: ps.publishedDeleted ?? false,
        draftUpdatedAt: ps.draftUpdatedAt ?? null,
        publishedUpdatedAt: ps.publishedUpdatedAt ?? null,
        isStarter: ABOUT_PAGE_SLUGS.includes(ps.slug as any),
      };
    });

    const nextCatalogs: Record<string, CatalogEditorState> = {};
    state.catalog.forEach((entry) => {
      if (!nextPages[entry.slug]) {
        return;
      }
      nextCatalogs[entry.slug] = {
        local: { ...entry.draft },
        server: { ...entry.draft },
        published: { ...entry.published },
      };
    });

    setDefaults(nextDefaults);
    setPages(nextPages);
    setCatalogs(nextCatalogs);

    // If the current slug no longer exists, jump to 'about' or the first available slug
    const availableSlugs = Object.keys(nextPages);
    setSlug((prev) => {
      if (availableSlugs.includes(prev)) return prev;
      return availableSlugs.includes('about') ? 'about' : (availableSlugs[0] ?? 'about');
    });
    setNewPageTemplate((prev) => availableSlugs.includes(prev) ? prev : (availableSlugs[0] ?? 'about'));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await adminFetch<AdminAboutEditorState>('/api/admin/about/v2/editor-state');
      applyEditorState(state);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setRenameInput(slug); }, [slug]);

  // ── Derived values ────────────────────────────────────────────────────────

  const pageSlugs = useMemo(() => {
    if (!pages || !catalogs) return [];
    const allSlugs = new Set([...Object.keys(pages), ...Object.keys(catalogs)]);
    return [...allSlugs].sort((a, b) => {
      if (a === 'about') return -1;
      if (b === 'about') return 1;
      const aOrder = catalogs[a]?.local.order ?? 0;
      const bOrder = catalogs[b]?.local.order ?? 0;
      return aOrder !== bOrder ? aOrder - bOrder : a.localeCompare(b);
    });
  }, [pages, catalogs]);

  // A slug is "dirty" if:
  // - local content differs from serverDraft (unsaved local change), OR
  // - serverDraft differs from published (unpublished server draft)
  const dirtySet = useMemo(() => {
    const result = new Set<string>();
    if (!pages || !catalogs) return result;
    for (const s of Object.keys(pages)) {
      const page = pages[s];
      const catalog = catalogs[s];
      const localDiffServer = JSON.stringify(page.local) !== JSON.stringify(page.serverDraft);
      const serverDiffPublished = JSON.stringify(page.serverDraft) !== JSON.stringify(page.published);
      const catalogLocalDiffServer = catalog ? JSON.stringify(catalog.local) !== JSON.stringify(catalog.server) : false;
      const catalogServerDiffPublished = catalog ? JSON.stringify(catalog.server) !== JSON.stringify(catalog.published) : false;
      const deletedMismatch = page.draftDeleted !== page.publishedDeleted;
      if (localDiffServer || serverDiffPublished || catalogLocalDiffServer || catalogServerDiffPublished || deletedMismatch) {
        result.add(s);
      }
    }
    return result;
  }, [pages, catalogs]);

  const pageState = pages?.[slug] ?? null;
  const catalogState = catalogs?.[slug] ?? null;
  const draft = pageState?.local ?? null;
  const dirty = dirtySet.has(slug);
  const globalChangedCount = dirtySet.size;

  // ── Local state updaters ──────────────────────────────────────────────────

  const upPage = (fn: (p: AboutPageContent) => AboutPageContent) => {
    setPages((prev) => {
      if (!prev || !prev[slug]) return prev;
      return { ...prev, [slug]: { ...prev[slug], local: fn(cloneAboutPage(prev[slug].local)) } };
    });
  };

  const upHero = (k: keyof AboutPageContent['hero'], v: string) =>
    upPage((p) => ({ ...p, hero: { ...p.hero, [k]: v } }));

  const upSec = (i: number, fn: (s: AboutSection) => AboutSection) =>
    upPage((p) => ({ ...p, sections: p.sections.map((s, j) => (j === i ? fn(s) : s)) }));

  const moveSec = (i: number, d: -1 | 1) =>
    upPage((p) => ({ ...p, sections: reorder(p.sections, i, d) }));

  const removeSec = (i: number) =>
    upPage((p) => ({ ...p, sections: p.sections.filter((_, j) => j !== i) }));

  const addSection = (type: string) =>
    upPage((p) => ({ ...p, sections: [...p.sections, makeBlankSection(type)] }));

  const upCatalog = (fn: (c: AboutCatalogState) => AboutCatalogState) => {
    setCatalogs((prev) => {
      if (!prev || !prev[slug]) return prev;
      return { ...prev, [slug]: { ...prev[slug], local: fn({ ...prev[slug].local }) } };
    });
  };

  // ── Auto-save draft ───────────────────────────────────────────────────────
  // Fires 600ms after local changes, only if local !== serverDraft.

  useEffect(() => {
    if (!pages || !pages[slug]) return;
    const page = pages[slug];
    if (JSON.stringify(page.local) === JSON.stringify(page.serverDraft)) return;

    clearTimeout(autosaveTimers.current[slug]);
    autosaveTimers.current[slug] = setTimeout(async () => {
      setAutosaving(true);
      try {
        const payload = cloneAboutPage(page.local);
        payload.slug = slug;
        const saved = await adminFetch<{ slug: string; draftPage: AboutPageContent; draftUpdatedAt: string }>(
          `/api/admin/about/v2/draft/pages/${slug}`,
          { method: 'PUT', body: JSON.stringify(payload) }
        );
        setPages((prev) => {
          if (!prev || !prev[slug]) return prev;
          return {
            ...prev,
            [slug]: {
              ...prev[slug],
              serverDraft: cloneAboutPage(saved.draftPage),
              draftDeleted: false,
              draftUpdatedAt: saved.draftUpdatedAt,
            },
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Auto-save failed');
      } finally {
        setAutosaving(false);
      }
    }, 600);

    return () => clearTimeout(autosaveTimers.current[slug]);
  }, [pages?.[slug]?.local]);

  // ── Auto-save catalog ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!catalogs || !catalogs[slug]) return;
    const cat = catalogs[slug];
    if (JSON.stringify(cat.local) === JSON.stringify(cat.server)) return;

    const timer = setTimeout(async () => {
      try {
        const saved = await adminFetch<{ slug: string; draft: AboutCatalogState; draftDeleted: boolean }>(
          `/api/admin/about/v2/draft/catalog/${slug}`,
          { method: 'PATCH', body: JSON.stringify(cat.local) }
        );
        setCatalogs((prev) => {
          if (!prev || !prev[slug]) return prev;
          return { ...prev, [slug]: { ...prev[slug], server: { ...saved.draft }, local: { ...saved.draft } } };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Catalog auto-save failed');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [catalogs?.[slug]?.local]);

  // ── Flush helpers (ensure latest data is on server before publish) ─────────

  const flushDraft = async (targetSlug: string) => {
    if (!pages || !pages[targetSlug]) return;
    const page = pages[targetSlug];
    if (JSON.stringify(page.local) === JSON.stringify(page.serverDraft)) return;
    clearTimeout(autosaveTimers.current[targetSlug]);
    const payload = cloneAboutPage(page.local);
    payload.slug = targetSlug;
    const saved = await adminFetch<{ slug: string; draftPage: AboutPageContent; draftUpdatedAt: string }>(
      `/api/admin/about/v2/draft/pages/${targetSlug}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    );
    setPages((prev) => {
      if (!prev || !prev[targetSlug]) return prev;
      return {
        ...prev,
        [targetSlug]: {
          ...prev[targetSlug],
          serverDraft: cloneAboutPage(saved.draftPage),
          draftDeleted: false,
          draftUpdatedAt: saved.draftUpdatedAt,
        },
      };
    });
  };

  const flushCatalog = async (targetSlug: string) => {
    if (!catalogs || !catalogs[targetSlug]) return;
    const cat = catalogs[targetSlug];
    if (JSON.stringify(cat.local) === JSON.stringify(cat.server)) return;
    const saved = await adminFetch<{ slug: string; draft: AboutCatalogState; draftDeleted: boolean }>(
      `/api/admin/about/v2/draft/catalog/${targetSlug}`,
      { method: 'PATCH', body: JSON.stringify(cat.local) }
    );
    setCatalogs((prev) => {
      if (!prev || !prev[targetSlug]) return prev;
      return { ...prev, [targetSlug]: { ...prev[targetSlug], server: { ...saved.draft }, local: { ...saved.draft } } };
    });
  };

  // ── Publish all ───────────────────────────────────────────────────────────
  // Flushes ALL dirty slugs before publishing, not just the current one.

  const publishAll = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Flush every dirty slug so the server has the latest before publish
      await Promise.all(
        [...dirtySet].map(async (s) => {
          await flushDraft(s);
          await flushCatalog(s);
        })
      );
      const result = await adminFetch<{ success: boolean; editorState: AdminAboutEditorState }>(
        '/api/admin/about/v2/publish',
        { method: 'POST' }
      );
      applyEditorState(result.editorState);
      setNotice('All draft changes published.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to publish');
    } finally {
      setSaving(false);
    }
  };

  // ── Revert ────────────────────────────────────────────────────────────────

  const revert = async () => {
    if (!window.confirm(`Revert "${labelFromSlug(slug)}" draft to its published version?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminFetch<{ success: boolean; editorState: AdminAboutEditorState }>(
        '/api/admin/about/v2/draft/reset',
        { method: 'POST', body: JSON.stringify({ slug }) }
      );
      applyEditorState(result.editorState);
      setNotice('Draft reset to published.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to reset draft');
    } finally {
      setSaving(false);
    }
  };

  const undoStagedDelete = async () => {
    if (!pageState?.draftDeleted || pageState.publishedDeleted) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminFetch<{ success: boolean; editorState: AdminAboutEditorState }>(
        '/api/admin/about/v2/draft/reset',
        { method: 'POST', body: JSON.stringify({ slug }) }
      );
      applyEditorState(result.editorState);
      setNotice(`Staged delete removed for "${labelFromSlug(slug)}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to undo staged delete');
    } finally {
      setSaving(false);
    }
  };

  // ── Load defaults ─────────────────────────────────────────────────────────

  const loadDefaults = async () => {
    if (!defaults) return;
    if (!window.confirm(`Replace "${labelFromSlug(slug)}" draft with default content?`)) return;
    const source = defaults[slug] ?? defaults['about'] ?? Object.values(defaults)[0];
    if (!source) return;
    const nextPage = cloneAboutPage(source);
    nextPage.slug = slug;
    if (!defaults[slug]) nextPage.navLabel = labelFromSlug(slug);

    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/about/v2/draft/pages/${slug}`, {
        method: 'PUT',
        body: JSON.stringify(nextPage),
      });
      await load();
      setNotice('Default content restored to draft.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to load defaults');
    } finally {
      setSaving(false);
    }
  };

  // ── Page visibility ───────────────────────────────────────────────────────

  const setPageEnabled = async (targetSlug: string, enabled: boolean) => {
    if (!catalogs?.[targetSlug]) return;
    const next = { ...catalogs[targetSlug].local, enabled, deleted: false };
    setCatalogs((prev) => {
      if (!prev) return prev;
      return { ...prev, [targetSlug]: { ...prev[targetSlug], local: next } };
    });
    try {
      await adminFetch(`/api/admin/about/v2/draft/catalog/${targetSlug}`, {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
      setCatalogs((prev) => {
        if (!prev) return prev;
        return { ...prev, [targetSlug]: { ...prev[targetSlug], server: next, local: next } };
      });
      setNotice(`${labelFromSlug(targetSlug)} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to update visibility');
      void load();
    }
  };

  // ── Reorder pages ─────────────────────────────────────────────────────────

  const movePageOrder = async (targetSlug: string, direction: -1 | 1) => {
    if (!catalogs || targetSlug === 'about') return;
    const movable = pageSlugs.filter((s) => s !== 'about');
    const index = movable.indexOf(targetSlug);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= movable.length) return;
    const swapSlug = movable[nextIndex];
    const current = catalogs[targetSlug]?.local;
    const swap = catalogs[swapSlug]?.local;
    if (!current || !swap) return;

    const nextCurrent = { ...current, order: swap.order };
    const nextSwap = { ...swap, order: current.order };
    setCatalogs((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [targetSlug]: { ...prev[targetSlug], local: nextCurrent },
        [swapSlug]: { ...prev[swapSlug], local: nextSwap },
      };
    });

    try {
      await Promise.all([
        adminFetch(`/api/admin/about/v2/draft/catalog/${targetSlug}`, { method: 'PATCH', body: JSON.stringify(nextCurrent) }),
        adminFetch(`/api/admin/about/v2/draft/catalog/${swapSlug}`, { method: 'PATCH', body: JSON.stringify(nextSwap) }),
      ]);
      setCatalogs((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [targetSlug]: { ...prev[targetSlug], server: nextCurrent },
          [swapSlug]: { ...prev[swapSlug], server: nextSwap },
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to reorder pages');
      void load();
    }
  };

  // ── Create page ───────────────────────────────────────────────────────────

  const createPage = async () => {
    const normalized = normalizeSlugInput(newPageSlug);
    if (!normalized || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
      setError('Slug must use lowercase letters, numbers, and hyphens only.');
      return;
    }
    if (pages?.[normalized]) {
      setError('A page with that slug already exists.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminFetch('/api/admin/about/v2/draft/pages', {
        method: 'POST',
        body: JSON.stringify({ slug: normalized, templateSlug: newPageTemplate }),
      });
      await load();
      setSlug(normalized);
      setNewPageSlug('');
      setNotice(`Draft page "${normalized}" created.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to create page');
    } finally {
      setSaving(false);
    }
  };

  // ── Rename slug ───────────────────────────────────────────────────────────

  const renameSlug = async () => {
    if (!draft || !catalogState || !pages) return;
    const nextSlug = normalizeSlugInput(renameInput);
    if (!nextSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
      setError('Slug must use lowercase letters, numbers, and hyphens only.');
      return;
    }
    if (nextSlug === slug) { setNotice('Slug is unchanged.'); return; }
    if (pages[nextSlug]) { setError('A page with that slug already exists.'); return; }
    if (pageState?.isStarter) {
      if (!window.confirm(`Renaming a starter page slug may break navigation. Continue?`)) return;
    }

    setSaving(true);
    setError(null);
    try {
      await flushDraft(slug);
      await flushCatalog(slug);

      const renamed = cloneAboutPage(draft);
      renamed.slug = nextSlug;
      if (!renamed.navLabel?.trim()) renamed.navLabel = labelFromSlug(nextSlug);

      await adminFetch(`/api/admin/about/v2/draft/pages/${nextSlug}`, {
        method: 'PUT',
        body: JSON.stringify(renamed),
      });
      await adminFetch(`/api/admin/about/v2/draft/catalog/${nextSlug}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...catalogState.local, deleted: false }),
      });
      await adminFetch(`/api/admin/about/v2/draft/pages/${slug}`, { method: 'DELETE' });

      await load();
      setSlug(nextSlug);
      setNotice(`Slug changed from "${slug}" to "${nextSlug}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to rename slug');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete page ───────────────────────────────────────────────────────────

  const deletePage = async () => {
    const label = labelFromSlug(slug);
    if (!window.confirm(`Stage delete for "${label}"? This will take effect when you publish.`)) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/about/v2/draft/pages/${slug}`, { method: 'DELETE' });
      await load();
      setNotice(`"${slug}" staged for deletion. Click Publish All to remove it from the live site.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to stage deletion');
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-cards for the /about linkGrid ────────────────────────────────────

  const autoCardItems = useMemo(() => {
    if (!catalogs) return [];
    return pageSlugs
      .filter((s) => s !== 'about')
      .map((s) => ({ slug: s, cat: catalogs[s]?.local }))
      .filter((e): e is { slug: string; cat: AboutCatalogState } => !!e.cat && !e.cat.deleted && e.cat.enabled)
      .sort((a, b) => (a.cat.order - b.cat.order) || a.slug.localeCompare(b.slug))
      .map((e) => ({
        hidden: false,
        title: e.cat.cardTitle,
        description: e.cat.cardDescription,
        href: publicPathForSlug(e.slug),
        image: e.cat.cardImage,
      }));
  }, [catalogs, pageSlugs]);

  const previewPage = useMemo(() => {
    const source = draft;
    if (!source || slug !== 'about') return source;
    const next = cloneAboutPage(source);
    const idx = next.sections.findIndex((s) => s.type === 'linkGrid');
    if (idx >= 0) {
      next.sections[idx] = { ...(next.sections[idx] as AboutLinkGridSection), items: autoCardItems };
    }
    return next;
  }, [draft, slug, autoCardItems]);

  const previewViewportClass =
    previewViewport === 'mobile'
      ? 'mx-auto w-[413px] max-w-full'
      : previewViewport === 'tablet'
        ? 'mx-auto w-full max-w-[900px]'
        : 'w-full';
  const isMobilePreview = previewViewport === 'mobile';
  const iphoneFrameWidth = 413;
  const iphoneFrameHeight = 872;
  const iphoneFrameScale = 0.78;
  const iphoneScaledWidth = Math.round(iphoneFrameWidth * iphoneFrameScale);
  const iphoneScaledHeight = Math.round(iphoneFrameHeight * iphoneFrameScale);
  const publishedPage = pageState?.published ?? null;
  const headerChanged = useMemo(() => {
    if (!draft) return false;
    if (!publishedPage) return true;
    return JSON.stringify({ navLabel: draft.navLabel, hero: draft.hero })
      !== JSON.stringify({ navLabel: publishedPage.navLabel, hero: publishedPage.hero });
  }, [draft, publishedPage]);
  const headerFieldChanged = useMemo(() => {
    if (!draft) {
      return {
        navLabel: false,
        eyebrow: false,
        title: false,
        accent: false,
        description: false
      };
    }
    if (!publishedPage) {
      return {
        navLabel: true,
        eyebrow: true,
        title: true,
        accent: true,
        description: true
      };
    }
    return {
      navLabel: draft.navLabel !== publishedPage.navLabel,
      eyebrow: draft.hero.eyebrow !== publishedPage.hero.eyebrow,
      title: draft.hero.title !== publishedPage.hero.title,
      accent: draft.hero.accent !== publishedPage.hero.accent,
      description: draft.hero.description !== publishedPage.hero.description
    };
  }, [draft, publishedPage]);
  const changedSectionIds = useMemo(() => {
    const changed = new Set<string>();
    if (!draft) return changed;
    const publishedSections = publishedPage?.sections ?? [];
    const byId = new Map(publishedSections.map((section) => [section.id, section]));
    for (const section of draft.sections) {
      const publishedSection = byId.get(section.id);
      if (!publishedSection || JSON.stringify(section) !== JSON.stringify(publishedSection)) {
        changed.add(section.id);
      }
    }
    return changed;
  }, [draft, publishedPage]);
  const catalogChanged = useMemo(() => {
    if (!catalogState) return false;
    return JSON.stringify(catalogState.local) !== JSON.stringify(catalogState.published);
  }, [catalogState]);

  const pushMobilePreviewToFrame = () => {
    if (!isMobilePreview || !previewPage) return;
    const win = mobilePreviewIframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'ADMIN_ABOUT_PREVIEW',
        slug,
        page: previewPage,
      },
      window.location.origin
    );
  };

  useEffect(() => {
    pushMobilePreviewToFrame();
  }, [isMobilePreview, slug, previewPage]);

  // ── Loading / error state ─────────────────────────────────────────────────

  if (loading || !pages || !draft || !pageState || !catalogs || !defaults) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-zinc-400">
        {error
          ? <><AlertCircle className="h-4 w-4 text-red-500" /><span className="text-sm text-red-600">{error}</span></>
          : <><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading editor…</span></>}
      </div>
    );
  }

  const published = formatUpdatedAt(pageState.publishedUpdatedAt);

  // ── Section renderer ──────────────────────────────────────────────────────

  const renderSection = (section: AboutSection, si: number) => {
    const galleryOnlySection = isSubpageGallerySection(slug, section);
    const label = galleryOnlySection
      ? 'Gallery'
      : `${SECTION_TYPE_LABELS[section.type] ?? section.type}${(section as any).heading ? ` — ${(section as any).heading}` : ''}`;
    const shellProps = {
      id: section.id,
      index: si + 1,
      label,
      changed: changedSectionIds.has(section.id),
      gallerySection: galleryOnlySection,
      hidden: section.hidden === true,
      onToggleHidden: () => upSec(si, (s) => ({ ...s, hidden: s.hidden !== true })),
      isFirst: si === 0,
      isLast: si === draft.sections.length - 1,
      onMoveUp: () => moveSec(si, -1),
      onMoveDown: () => moveSec(si, 1),
      onRemove: () => removeSec(si),
    };

    const headerFields = (
      <Row2>
        <Field label="Eyebrow">
          <input value={(section as any).eyebrow ?? ''} onChange={(e) => upSec(si, (s) => ({ ...s, eyebrow: e.target.value }))} className={inputClass} placeholder="Optional label above heading" />
        </Field>
        <Field label="Heading">
          <input value={(section as any).heading ?? ''} onChange={(e) => upSec(si, (s) => ({ ...s, heading: e.target.value }))} className={inputClass} placeholder="Section heading" />
        </Field>
      </Row2>
    );

    switch (section.type) {
      case 'story':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <Field label="Lead line">
              <input value={section.lead} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutStorySection), lead: e.target.value }))} className={inputClass} placeholder="First line displayed prominently" />
            </Field>
            <Row2>
              <Field label="Pull quote">
                <textarea value={section.quote ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutStorySection), quote: e.target.value }))} className={taClass} placeholder="Optional quote" />
              </Field>
              <Field label="Quote attribution">
                <input value={section.quoteAttribution ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutStorySection), quoteAttribution: e.target.value }))} className={inputClass} placeholder="— Name, Role" />
              </Field>
            </Row2>
            <StringList label="Body paragraphs" values={section.paragraphs} addLabel="Add paragraph"
              onChange={(v) => upSec(si, (s) => ({ ...(s as AboutStorySection), paragraphs: v }))}
              placeholder="Paragraph text…" />
          </SectionShell>
        );

      case 'linkGrid':
        if (slug === 'about') {
          return (
            <SectionShell key={section.id} {...shellProps}>
              {headerFields}
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Cards are auto-generated from enabled pages' catalog metadata (title, description, image, order). Edit those in the sidebar on each page.
              </div>
              {autoCardItems.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-200 py-3 text-center text-xs text-zinc-400">
                  No enabled pages to display yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {autoCardItems.map((item, ii) => (
                    <div key={ii} className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm">
                      <span className="font-semibold text-zinc-800">{item.title || '(untitled)'}</span>
                      <span className="ml-2 text-zinc-400">{item.href}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionShell>
          );
        }
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <div className="space-y-3">
              {section.items.map((item, ii) => (
                <SubItem key={`${section.id}-link-${ii}`}
                  title={`Card ${ii + 1}${item.title ? ` — ${item.title}` : ''}`}
                  index={ii} length={section.items.length}
                  onMove={(d) => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: reorder((s as AboutLinkGridSection).items, ii, d) }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: (s as AboutLinkGridSection).items.filter((_, j) => j !== ii) }))}
                >
                  <Row2>
                    <Field label="Title"><input value={item.title} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: (s as AboutLinkGridSection).items.map((x, j) => j === ii ? { ...x, title: e.target.value } : x) }))} className={inputClass} /></Field>
                    <Field label="URL"><input value={item.href} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: (s as AboutLinkGridSection).items.map((x, j) => j === ii ? { ...x, href: e.target.value } : x) }))} placeholder="/tech-crew" className={inputClass} /></Field>
                  </Row2>
                  <Field label="Description"><textarea value={item.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: (s as AboutLinkGridSection).items.map((x, j) => j === ii ? { ...x, description: e.target.value } : x) }))} className={taClass} /></Field>
                  <ImageField label="Card image" value={item.image} optional
                    onChange={(img) => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: (s as AboutLinkGridSection).items.map((x, j) => j === ii ? { ...x, image: img } : x) }))} />
                </SubItem>
              ))}
              <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: [...(s as AboutLinkGridSection).items, { hidden: false, title: '', description: '', href: '' }] }))}>
                <Link2 className="h-3.5 w-3.5" /> Add card
              </AddBtn>
            </div>
          </SectionShell>
        );

      case 'people':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <div className="space-y-3">
              {section.items.map((person, ii) => (
                <SubItem key={`${section.id}-person-${ii}`}
                  title={`Person ${ii + 1}${person.name ? ` — ${person.name}` : ''}`}
                  index={ii} length={section.items.length}
                  onMove={(d) => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: reorder((s as AboutPeopleSection).items, ii, d) }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: (s as AboutPeopleSection).items.filter((_, j) => j !== ii) }))}
                >
                  <Row2>
                    <Field label="Name"><input value={person.name} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: (s as AboutPeopleSection).items.map((x, j) => j === ii ? { ...x, name: e.target.value } : x) }))} className={inputClass} /></Field>
                    <Field label="Role"><input value={person.role} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: (s as AboutPeopleSection).items.map((x, j) => j === ii ? { ...x, role: e.target.value } : x) }))} className={inputClass} /></Field>
                  </Row2>
                  <Field label="Bio"><textarea value={person.bio ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: (s as AboutPeopleSection).items.map((x, j) => j === ii ? { ...x, bio: e.target.value } : x) }))} className={taClass} /></Field>
                  <ImageField label="Portrait" value={person.image}
                    onChange={(img) => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: (s as AboutPeopleSection).items.map((x, j) => j === ii ? { ...x, image: img ?? { url: '', alt: '' } } : x) }))} />
                </SubItem>
              ))}
              <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: [...(s as AboutPeopleSection).items, { name: '', role: '', bio: '', image: { url: '', alt: '' } }] }))}>
                <FilePenLine className="h-3.5 w-3.5" /> Add person
              </AddBtn>
            </div>
          </SectionShell>
        );

      case 'history': {
        const hs = section as AboutHistorySection;
        return (
          <SectionShell key={hs.id} {...shellProps}>
            {headerFields}
            <Field label="Intro description"><textarea value={hs.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), description: e.target.value }))} className={taClass} /></Field>
            <div className="space-y-3">
              <FieldLabel>Entries</FieldLabel>
              {hs.items.map((item, ii) => (
                <SubItem key={`${hs.id}-history-${ii}`}
                  title={`${item.year || 'Entry'} ${ii + 1}${item.title ? ` — ${item.title}` : ''}`}
                  index={ii} length={hs.items.length}
                  onMove={(d) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: reorder((s as AboutHistorySection).items, ii, d) }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.filter((_, j) => j !== ii) }))}
                >
                  <Row2>
                    <Field label="Year"><input value={item.year} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, year: e.target.value } : x) }))} className={inputClass} placeholder="e.g. 2019" /></Field>
                    <Field label="Title"><input value={item.title} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, title: e.target.value } : x) }))} className={inputClass} /></Field>
                  </Row2>
                  <Field label="Description"><textarea value={item.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, description: e.target.value } : x) }))} className={taClass} /></Field>
                  <ImageField label="Image" value={item.image}
                    onChange={(img) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, image: img ?? { url: '', alt: '' } } : x) }))} />
                </SubItem>
              ))}
              <AddBtn onClick={() => upSec(si, (s) => ({
                ...(s as AboutHistorySection),
                items: [...(s as AboutHistorySection).items, { year: '', title: '', description: '', image: { url: '', alt: '' } } satisfies AboutHistoryItem],
              }))}>
                <Plus className="h-3.5 w-3.5" /> Add entry
              </AddBtn>
            </div>
          </SectionShell>
        );
      }

      case 'calendar': {
        const calendarSection = section as AboutCalendarSection;
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <Field label="Description">
              <textarea
                value={calendarSection.description}
                onChange={(e) =>
                  upSec(si, (s) => ({ ...(s as AboutCalendarSection), description: e.target.value }))
                }
                className={taClass}
                placeholder="Text shown above the embedded calendar"
              />
            </Field>
            <Field label="Calendar URL">
              <input
                value={calendarSection.calendarUrl ?? ''}
                onChange={(e) =>
                  upSec(si, (s) => ({ ...(s as AboutCalendarSection), calendarUrl: e.target.value }))
                }
                className={inputClass}
                placeholder="https://calendar.google.com/calendar/ical/.../public/basic.ics"
              />
            </Field>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
              Need help getting the right link?{' '}
              <button
                type="button"
                onClick={() => setShowCalendarInstructions(true)}
                className="font-semibold text-red-700 underline decoration-red-300 underline-offset-2 hover:text-red-800"
              >
                Click here for instructions
              </button>
              .
            </div>
          </SectionShell>
        );
      }

      case 'featureGrid':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <Field label="Intro text"><textarea value={section.intro} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), intro: e.target.value }))} className={taClass} /></Field>
            <div className="space-y-3">
              <FieldLabel>Cards</FieldLabel>
              {section.items.map((item, ii) => (
                <SubItem key={`${section.id}-feat-${ii}`}
                  title={`Card ${ii + 1}${item.title ? ` — ${item.title}` : ''}`}
                  index={ii} length={section.items.length}
                  onMove={(d) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: reorder((s as AboutFeatureGridSection).items, ii, d) }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: (s as AboutFeatureGridSection).items.filter((_, j) => j !== ii) }))}
                >
                  <Field label="Title"><input value={item.title} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: (s as AboutFeatureGridSection).items.map((x, j) => j === ii ? { ...x, title: e.target.value } : x) }))} className={inputClass} /></Field>
                  <Field label="Description"><textarea value={item.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: (s as AboutFeatureGridSection).items.map((x, j) => j === ii ? { ...x, description: e.target.value } : x) }))} className={taClass} /></Field>
                </SubItem>
              ))}
              <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: [...(s as AboutFeatureGridSection).items, { title: '', description: '' }] }))}>
                <Plus className="h-3.5 w-3.5" /> Add card
              </AddBtn>
            </div>
          </SectionShell>
        );

      case 'splitFeature':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {galleryOnlySection
              ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Gallery-only section: the public page uses image and alt text from this section.
                </div>
              )
              : (
                <>
                  {headerFields}
                  <Field label="Lead text"><textarea value={section.lead} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), lead: e.target.value }))} className={taClass} /></Field>
                  <StringList label="Body paragraphs" values={section.body} addLabel="Add paragraph"
                    onChange={(v) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), body: v }))} />
                  <StringList label="Bullet points" values={section.bullets} addLabel="Add bullet"
                    onChange={(v) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), bullets: v }))} />
                  <Row2>
                    <Field label="Callout title"><input value={section.calloutTitle ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), calloutTitle: e.target.value }))} className={inputClass} /></Field>
                    <Field label="Callout body"><input value={section.calloutBody ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), calloutBody: e.target.value }))} className={inputClass} /></Field>
                  </Row2>
                </>
              )}
            <div className="space-y-3">
              <FieldLabel>Images</FieldLabel>
              {section.images.map((img, ii) => (
                <SubItem key={`${section.id}-img-${ii}`} title={`Image ${ii + 1}`}
                  index={ii} length={section.images.length}
                  onMove={(d) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), images: reorder((s as AboutSplitFeatureSection).images, ii, d) }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), images: (s as AboutSplitFeatureSection).images.filter((_, j) => j !== ii) }))}
                >
                  <ImageField label={`Image ${ii + 1}`} value={img}
                    onChange={(next) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), images: (s as AboutSplitFeatureSection).images.map((x, j) => j === ii ? (next ?? { url: '', alt: '' }) : x) }))} />
                </SubItem>
              ))}
              <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), images: [...(s as AboutSplitFeatureSection).images, { url: '', alt: '' }] }))}>
                <ImagePlus className="h-3.5 w-3.5" /> Add image
              </AddBtn>
            </div>
          </SectionShell>
        );

      case 'testimonial':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <Field label="Quote"><textarea value={section.quote} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutTestimonialSection), quote: e.target.value }))} className={taClass} /></Field>
            <Field label="Attribution"><input value={section.attribution} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutTestimonialSection), attribution: e.target.value }))} className={inputClass} placeholder="— Name, Role" /></Field>
            <ImageField label="Feature image" value={section.image}
              onChange={(img) => upSec(si, (s) => ({ ...(s as AboutTestimonialSection), image: img ?? { url: '', alt: '' } }))} />
          </SectionShell>
        );

      case 'listPanel':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <Field label="Main body"><textarea value={section.body} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), body: e.target.value }))} className={taClass} /></Field>
            <Row2>
              <Field label="Panel title"><input value={section.panelTitle} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), panelTitle: e.target.value }))} className={inputClass} /></Field>
              <Field label="Panel intro"><input value={section.panelBody} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), panelBody: e.target.value }))} className={inputClass} /></Field>
            </Row2>
            <StringList label="Panel items" values={section.items} addLabel="Add item"
              onChange={(v) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), items: v }))} />
          </SectionShell>
        );

      case 'cta':
        return (
          <SectionShell key={section.id} {...shellProps}>
            {headerFields}
            <Field label="Body"><textarea value={section.body} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutCtaSection), body: e.target.value }))} className={taClass} /></Field>
            <div className="grid gap-3 xl:grid-cols-2">
              <ActionField label="Primary button" value={section.primary}
                onChange={(v) => upSec(si, (s) => ({ ...(s as AboutCtaSection), primary: v }))} />
              {section.secondary
                ? (
                  <ActionField label="Secondary button" value={section.secondary}
                    onChange={(v) => upSec(si, (s) => ({ ...(s as AboutCtaSection), secondary: v }))}
                    onRemove={() => upSec(si, (s) => ({ ...(s as AboutCtaSection), secondary: undefined }))} />
                )
                : (
                  <div className="flex items-start pt-6">
                    <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutCtaSection), secondary: { label: '', href: '' } }))}>
                      <Link2 className="h-3.5 w-3.5" /> Add secondary button
                    </AddBtn>
                  </div>
                )}
            </div>
            <Row2>
              <Field label="Contact label"><input value={section.contactLabel ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutCtaSection), contactLabel: e.target.value }))} className={inputClass} placeholder="e.g. Questions?" /></Field>
              <Field label="Contact value"><input value={section.contactValue ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutCtaSection), contactValue: e.target.value }))} className={inputClass} placeholder="email or phone" /></Field>
            </Row2>
          </SectionShell>
        );

      default:
        return null;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">About Pages</h1>
          <p className="mt-0.5 text-xs text-zinc-400">
            Drafts auto-save as you type. Use "Publish All" to push changes live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {globalChangedCount > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
              {globalChangedCount} page{globalChangedCount !== 1 ? 's' : ''} with unpublished changes
            </span>
          )}
          {autosaving && (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
          <a
            href={publicPathForSlug(slug)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            <ExternalLink className="h-4 w-4" /> View live
          </a>
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${showPreview ? 'border-red-300 bg-red-50 text-red-700' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
          >
            {showPreview ? 'Hide preview' : 'Preview'}
          </button>
        </div>
      </div>

      {/* Banners */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="h-4 w-4 text-red-400 hover:text-red-600" /></button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)}><X className="h-4 w-4 text-emerald-400 hover:text-emerald-600" /></button>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">

        {/* ── Sidebar ── */}
        <aside className="space-y-4">

          {/* Page list */}
          <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
            <div className="border-b border-zinc-100 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Pages</p>
            </div>
            <div className="divide-y divide-zinc-100">
              {pageSlugs.map((s) => {
                const active = s === slug;
                const d = dirtySet.has(s);
                const cat = catalogs[s];
                const enabled = cat?.local.enabled ?? (s !== 'about');
                const stagedDelete = pages[s]?.draftDeleted ?? false;
                const publishedDelete = pages[s]?.publishedDeleted ?? false;

                return (
                  <div key={s} className={`transition ${active ? 'bg-red-50' : 'hover:bg-zinc-50'}`}>
                    <button
                      type="button"
                      onClick={() => { setSlug(s); setError(null); setNotice(null); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold truncate ${active ? 'text-red-700' : 'text-zinc-900'}`}>
                            {ABOUT_PAGE_LABELS[s] ?? pages[s]?.local.navLabel ?? labelFromSlug(s)}
                          </span>
                          {d && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Unsaved changes" />}
                        </div>
                        <div className="text-xs text-zinc-400 truncate">{publicPathForSlug(s)}</div>
                      </div>
                      {stagedDelete && !publishedDelete && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Staged delete</span>
                      )}
                      {publishedDelete && (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">Deleted live</span>
                      )}
                    </button>
                    {s !== 'about' && (
                      <div className="flex items-center gap-1 px-4 pb-2.5">
                        <IconBtn onClick={() => void movePageOrder(s, -1)} title="Move up"><ArrowUp className="h-3 w-3" /></IconBtn>
                        <IconBtn onClick={() => void movePageOrder(s, 1)} title="Move down"><ArrowDown className="h-3 w-3" /></IconBtn>
                        <button
                          type="button"
                          onClick={() => void setPageEnabled(s, !enabled)}
                          className={`ml-1 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                            enabled
                              ? 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {enabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add new page */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Add Page</p>
            <input
              value={newPageSlug}
              onChange={(e) => setNewPageSlug(normalizeSlugInput(e.target.value))}
              placeholder="new-page-slug"
              className={inputClass}
            />
            <select
              value={newPageTemplate}
              onChange={(e) => setNewPageTemplate(e.target.value)}
              className={inputClass}
            >
              {pageSlugs
                .filter((s) => !pages[s]?.draftDeleted)
                .map((s) => (
                <option key={s} value={s}>
                  Template: {ABOUT_PAGE_LABELS[s] ?? labelFromSlug(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void createPage()}
              disabled={saving || !newPageSlug}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Create draft page
            </button>
          </div>

          {/* Current page actions */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                {ABOUT_PAGE_LABELS[slug] ?? labelFromSlug(slug)}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                dirty ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-zinc-100 text-zinc-500'
              }`}>
                {dirty ? 'Unpublished changes' : 'Up to date'}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              {pageState.draftDeleted && !pageState.publishedDeleted ? 'Draft: Staged for deletion (not live yet) · ' : ''}
              {pageState.publishedDeleted ? 'Published: Deleted live' : (published ? `Published ${published}` : 'Never published')}
            </p>

            {/* Slug rename */}
            <div className="space-y-2">
              <FieldLabel>Page slug</FieldLabel>
              <div className="flex gap-2">
                <input
                  value={renameInput}
                  onChange={(e) => setRenameInput(normalizeSlugInput(e.target.value))}
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => void renameSlug()}
                  disabled={saving || !renameInput || renameInput === slug}
                  className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                >
                  Rename
                </button>
              </div>
            </div>

            {/* Catalog card metadata (non-about pages) */}
            {catalogState && slug !== 'about' && (
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Get Involved Card</p>
                  {catalogChanged && (
                    <span
                      title="Has unpublished changes"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 ring-1 ring-amber-200/80"
                    />
                  )}
                </div>
                <Field label="Card title">
                  <input value={catalogState.local.cardTitle} onChange={(e) => upCatalog((c) => ({ ...c, cardTitle: e.target.value, deleted: false }))} className={inputClass} />
                </Field>
                <Field label="Card description">
                  <textarea value={catalogState.local.cardDescription} onChange={(e) => upCatalog((c) => ({ ...c, cardDescription: e.target.value, deleted: false }))} className={taClass} />
                </Field>
                <ImageField label="Card image" value={catalogState.local.cardImage} optional
                  onChange={(img) => upCatalog((c) => ({ ...c, cardImage: img, deleted: false }))} />
              </div>
            )}

            {/* Publish / revert / delete */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => void publishAll()}
                disabled={saving || globalChangedCount === 0}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Publishing…' : `Publish All${globalChangedCount > 0 ? ` (${globalChangedCount})` : ''}`}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void revert()}
                  disabled={saving}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Revert
                </button>
                <button
                  type="button"
                  onClick={() => void loadDefaults()}
                  disabled={saving}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Defaults
                </button>
              </div>
              {pageState.draftDeleted && !pageState.publishedDeleted ? (
                <button
                  type="button"
                  onClick={() => void undoStagedDelete()}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Undo staged delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void deletePage()}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Stage delete
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className={showPreview ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : undefined}>

          {/* Editor */}
          <div className="space-y-3">

            {/* Hero */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="mb-4 border-b border-zinc-100 pb-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-zinc-900">Page Header</h2>
                  {headerChanged && (
                    <span
                      title="Has unpublished changes"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 ring-1 ring-amber-200/80"
                    />
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">Navigation label and hero shown at the top of the page.</p>
              </div>
              <div className="space-y-3">
                <Row2>
                  <Field label="Navigation label" changed={headerFieldChanged.navLabel}>
                    <input value={draft.navLabel} onChange={(e) => upPage((p) => ({ ...p, navLabel: e.target.value }))} className={inputClass} placeholder="Shown in nav menu" />
                  </Field>
                  <Field label="Eyebrow" changed={headerFieldChanged.eyebrow}>
                    <input value={draft.hero.eyebrow} onChange={(e) => upHero('eyebrow', e.target.value)} className={inputClass} placeholder="Optional label above title" />
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Title" changed={headerFieldChanged.title}>
                    <input value={draft.hero.title} onChange={(e) => upHero('title', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Accent text" changed={headerFieldChanged.accent}>
                    <input value={draft.hero.accent} onChange={(e) => upHero('accent', e.target.value)} className={inputClass} placeholder="Highlighted word in title" />
                  </Field>
                </Row2>
                <Field label="Description" changed={headerFieldChanged.description}>
                  <textarea value={draft.hero.description} onChange={(e) => upHero('description', e.target.value)} className={taClass} />
                </Field>
              </div>
            </div>

            {/* Sections */}
            {draft.sections.map((section, si) => renderSection(section, si))}

            {/* Add section */}
            <AddSectionPicker onAdd={addSection} />

            {/* Unsaved nudge */}
            {dirty && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm text-amber-700">This page has unpublished changes.</p>
                <button
                  type="button"
                  onClick={() => void publishAll()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> Publish
                </button>
              </div>
            )}
          </div>

          {/* Preview */}
          {showPreview && (
            <div className="xl:sticky xl:top-6 xl:self-start">
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Preview</p>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                      {(['desktop', 'tablet', 'mobile'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setPreviewViewport(v)}
                          className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                            previewViewport === v
                              ? 'bg-white text-zinc-800 shadow-sm'
                              : 'text-zinc-500 hover:text-zinc-700'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-emerald-200">Live</span>
                  </div>
                </div>
                <div className={isMobilePreview ? 'overflow-hidden bg-zinc-50 p-3' : 'max-h-[calc(100vh-160px)] overflow-y-auto bg-zinc-50 p-3'}>
                  <div className={`${previewViewportClass} transition-all duration-200`}>
                    {previewPage && (
                      isMobilePreview ? (
                        <div className="relative mx-auto" style={{ width: iphoneScaledWidth, height: iphoneScaledHeight }}>
                          <div
                            className="absolute left-0 top-0 origin-top-left rounded-[52px] bg-zinc-900 p-[10px] shadow-2xl ring-1 ring-zinc-700/60"
                            style={{
                              width: iphoneFrameWidth,
                              height: iphoneFrameHeight,
                              transform: `scale(${iphoneFrameScale})`
                            }}
                          >
                            <div className="absolute inset-[10px] overflow-hidden rounded-[42px] bg-white">
                              <div className="pointer-events-none absolute left-1/2 top-2 z-20 h-8 w-[126px] -translate-x-1/2 rounded-[18px] bg-zinc-900" />
                              <iframe
                                key={slug}
                                ref={mobilePreviewIframeRef}
                                title="iPhone 15 Pro Preview"
                                src={publicPathForSlug(slug)}
                                onLoad={pushMobilePreviewToFrame}
                                className="block h-[852px] w-[393px] border-0"
                              />
                              <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 h-1.5 w-32 -translate-x-1/2 rounded-full bg-zinc-900/90" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <AboutPageRenderer page={previewPage} preview previewMode="admin" />
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {showCalendarInstructions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[2px]"
          onClick={() => setShowCalendarInstructions(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Calendar URL setup instructions"
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Calendar URL Setup</p>
                <h3 className="mt-1 text-lg font-bold text-zinc-900">How to Get a Public Calendar Link</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCalendarInstructions(false)}
                className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-700"
                aria-label="Close instructions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Google Calendar</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-700">
                  <li>Open calendar settings, then choose your calendar.</li>
                  <li>Enable public visibility if needed.</li>
                  <li>Copy the public ICS link from Integrate calendar.</li>
                </ol>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Apple Calendar (iCloud)</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-700">
                  <li>Open iCloud Calendar and click the share icon.</li>
                  <li>Enable Public Calendar.</li>
                  <li>Copy the shared link and paste it here.</li>
                </ol>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Microsoft Calendar (Outlook)</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-700">
                  <li>Open Outlook calendar settings, then Shared calendars.</li>
                  <li>Publish the calendar with can-view-all-details access.</li>
                  <li>Copy the ICS link and paste it here.</li>
                </ol>
              </div>
            </div>
            <div className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
              Tip: if your link starts with <code>webcal://</code>, you can still paste it directly.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
