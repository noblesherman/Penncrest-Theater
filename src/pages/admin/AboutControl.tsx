import { type ChangeEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp,
  ExternalLink, Eye, EyeOff, FilePenLine, ImagePlus, Link2, Loader2,
  RefreshCw, RotateCcw, Save, Trash2, Upload, X, AlertCircle, CheckCircle2,
} from 'lucide-react';
import AboutPageRenderer from '../../components/about/AboutPageRenderer';
import { adminFetch } from '../../lib/adminAuth';
import {
  ABOUT_PAGE_LABELS, ABOUT_PAGE_SLUGS, cloneAboutPage,
  type AboutCatalogState,
  type AdminAboutEditorPageState,
  type AdminAboutEditorState,
  type AboutAction, type AboutCtaSection, type AboutFeatureGridSection,
  type AboutHistoryItem, type AboutHistorySection, type AboutImage,
  type AboutLinkGridSection, type AboutListPanelSection, type AboutPageContent,
  type AboutPageSlug, type AboutPeopleSection, type AboutSection,
  type AboutSplitFeatureSection, type AboutStorySection, type AboutTestimonialSection,
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
  story: 'Story Block', linkGrid: 'Linked Cards', people: 'People Grid',
  calendar: 'Calendar Embed', history: 'History Timeline', featureGrid: 'Feature Grid',
  splitFeature: 'Split Feature', testimonial: 'Testimonial', listPanel: 'List Panel', cta: 'Call to Action',
};

function publicPathForSlug(slug: string): string {
  const starterPath = STARTER_PUBLIC_PATHS[slug];
  if (starterPath) {
    return starterPath;
  }
  return `/${slug}`;
}

function labelFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim() || 'About Page';
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

// ─── Utilities ────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') { reject(new Error('Failed to parse image.')); return; }
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
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

function formatUpdatedAt(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function reorder<T>(items: T[], index: number, direction: -1 | 1) {
  const next = index + direction;
  if (next < 0 || next >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

// ─── Shared field styles (consistent with site editor) ───────────────────────

const inputClass = 'w-full rounded-xl border border-stone-300 px-4 py-3 text-sm text-stone-900 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 placeholder:text-stone-400';
const taClass = `${inputClass} min-h-[88px] resize-y`;

function FieldLabel({ children }: { children: string }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{children}</p>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><FieldLabel>{label}</FieldLabel>{children}</div>;
}

function Row2({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function IconBtn({ onClick, disabled, title, variant = 'neutral', children }: {
  onClick: () => void; disabled?: boolean; title?: string;
  variant?: 'neutral' | 'danger'; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30
        ${variant === 'danger'
          ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
          : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'}`}>
      {children}
    </button>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-dashed border-stone-300 px-4 py-2.5 text-xs font-semibold text-stone-500 transition hover:border-stone-400 hover:bg-stone-50">
      {children}
    </button>
  );
}

function ReorderControls({ index, length, onMove, onRemove, disabled = false }: {
  index: number; length: number; onMove: (d: -1 | 1) => void; onRemove: () => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <IconBtn onClick={() => onMove(-1)} disabled={disabled || index === 0} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
      <IconBtn onClick={() => onMove(1)} disabled={disabled || index === length - 1} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
      <IconBtn onClick={onRemove} disabled={disabled} variant="danger" title="Remove"><Trash2 className="h-3.5 w-3.5" /></IconBtn>
    </div>
  );
}

// ─── Image field ──────────────────────────────────────────────────────────────

function ImageField({ label, value, onChange, optional, disabled }: {
  label: string; value?: AboutImage; onChange: (v: AboutImage | undefined) => void;
  optional?: boolean; disabled?: boolean;
}) {
  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    onChange({ url: await fileToDataUrl(file, 1600, 1600), alt: value?.alt ?? '' });
  };
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        {optional && value && (
          <button type="button" onClick={() => onChange(undefined)} disabled={disabled}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-40">
            <X className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {value?.url
            ? <img src={value.url} alt={value.alt} className="h-full w-full object-cover" />
            : <div className="flex h-full items-center justify-center text-stone-300"><ImagePlus className="h-5 w-5" /></div>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input value={value?.url ?? ''} onChange={(e) => onChange({ url: e.target.value, alt: value?.alt ?? '' })}
            disabled={disabled} placeholder="Image URL or upload →" className={inputClass} />
          <div className="flex items-center gap-2">
            <input value={value?.alt ?? ''} onChange={(e) => onChange({ url: value?.url ?? '', alt: e.target.value })}
              disabled={disabled} placeholder="Alt text" className={inputClass} />
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">
              <Upload className="h-3.5 w-3.5" /> Upload
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void onUpload(e)} disabled={disabled} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Action field ─────────────────────────────────────────────────────────────

function ActionField({ label, value, onChange, onRemove, disabled }: {
  label: string; value?: AboutAction; onChange: (v: AboutAction) => void;
  onRemove?: () => void; disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        {onRemove && (
          <button type="button" onClick={onRemove} disabled={disabled}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-40">
            <X className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
      <Row2>
        <Field label="Button label">
          <input value={value?.label ?? ''} onChange={(e) => onChange({ label: e.target.value, href: value?.href ?? '' })} disabled={disabled} placeholder="e.g. Learn More" className={inputClass} />
        </Field>
        <Field label="URL">
          <input value={value?.href ?? ''} onChange={(e) => onChange({ label: value?.label ?? '', href: e.target.value })} disabled={disabled} placeholder="/about or mailto:…" className={inputClass} />
        </Field>
      </Row2>
    </div>
  );
}

// ─── String list ──────────────────────────────────────────────────────────────

function StringList({ label, values, onChange, addLabel, disabled }: {
  label: string; values: string[]; onChange: (v: string[]) => void;
  addLabel: string; disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <button type="button" onClick={() => onChange([...values, ''])} disabled={disabled}
          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40">
          <Link2 className="h-3 w-3" /> {addLabel}
        </button>
      </div>
      {values.length === 0
        ? <p className="rounded-xl border border-dashed border-stone-200 py-3 text-center text-xs text-stone-400">No items yet — add one above</p>
        : (
          <div className="space-y-2">
            {values.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={v} onChange={(e) => onChange(values.map((x, j) => j === i ? e.target.value : x))}
                  disabled={disabled} placeholder={`Item ${i + 1}`} className={`${inputClass} flex-1`} />
                <ReorderControls index={i} length={values.length} disabled={disabled}
                  onMove={(d) => onChange(reorder(values, i, d))}
                  onRemove={() => onChange(values.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ─── Collapsible section shell ────────────────────────────────────────────────

function SectionShell({ id, index, label, hidden, onToggleHidden, onMoveUp, onMoveDown, onRemove, isFirst, isLast, children }: {
  id: string; index: number; label: string;
  hidden: boolean;
  onToggleHidden: () => void;
  onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
  isFirst: boolean; isLast: boolean;
  children: ReactNode;
  key?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-3 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-700 text-[10px] font-bold text-white">
            {index}
          </span>
          <span className="flex-1 text-sm font-semibold text-stone-900">{label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            hidden ? 'bg-stone-200 text-stone-600' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {hidden ? 'Hidden' : 'Visible'}
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-stone-400" /> : <ChevronDown className="h-4 w-4 text-stone-400" />}
        </button>
        <div className="flex items-center gap-1 pl-2">
          <button
            type="button"
            onClick={onToggleHidden}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              hidden
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
            }`}
          >
            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {hidden ? 'Show' : 'Hide'}
          </button>
          <IconBtn onClick={onMoveUp} disabled={isFirst} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn onClick={onMoveDown} disabled={isLast} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn onClick={onRemove} variant="danger" title="Remove section"><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </div>
      </div>
      {open && <div className="border-t border-stone-100 px-5 py-5 space-y-4">{children}</div>}
    </div>
  );
}

// ─── Sub-item card ────────────────────────────────────────────────────────────

function SubItem({ title, index, length, onMove, onRemove, children }: {
  title: string; index: number; length: number;
  onMove: (d: -1 | 1) => void; onRemove: () => void;
  children: ReactNode;
  key?: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50">
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <p className="text-xs font-semibold text-stone-500">{title}</p>
        <ReorderControls index={index} length={length} onMove={onMove} onRemove={onRemove} />
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminAboutControlPage() {
  const [pageStateBySlug, setPageStateBySlug] = useState<Record<AboutPageSlug, AdminAboutEditorPageState> | null>(null);
  const [defaults, setDefaults] = useState<Record<AboutPageSlug, AboutPageContent> | null>(null);
  const [drafts, setDrafts] = useState<Record<AboutPageSlug, AboutPageContent> | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<Record<AboutPageSlug, AboutPageContent> | null>(null);
  const [publishedPages, setPublishedPages] = useState<Record<AboutPageSlug, AboutPageContent | null> | null>(null);
  const [catalogDrafts, setCatalogDrafts] = useState<Record<AboutPageSlug, AboutCatalogState> | null>(null);
  const [savedCatalogDrafts, setSavedCatalogDrafts] = useState<Record<AboutPageSlug, AboutCatalogState> | null>(null);
  const [catalogPublished, setCatalogPublished] = useState<Record<AboutPageSlug, AboutCatalogState> | null>(null);
  const [slug, setSlug] = useState<AboutPageSlug>('about');
  const [newPageSlug, setNewPageSlug] = useState('');
  const [renameSlugInput, setRenameSlugInput] = useState('about');
  const [newPageTemplateSlug, setNewPageTemplateSlug] = useState<AboutPageSlug>('about');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autosavingDraft, setAutosavingDraft] = useState(false);
  const [autosavingCatalog, setAutosavingCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const applyEditorState = (editorState: AdminAboutEditorState) => {
    const nextDefaults = Object.fromEntries(editorState.defaults.map((p) => [p.slug, cloneAboutPage(p)])) as Record<AboutPageSlug, AboutPageContent>;
    const nextDrafts: Record<AboutPageSlug, AboutPageContent> = {};
    const nextSavedDrafts: Record<AboutPageSlug, AboutPageContent> = {};
    const nextPublishedPages: Record<AboutPageSlug, AboutPageContent | null> = {};
    const nextPageStates: Record<AboutPageSlug, AdminAboutEditorPageState> = {};

    const fallbackTemplate = editorState.defaults[0] ? cloneAboutPage(editorState.defaults[0]) : null;

    editorState.pages.forEach((pageState) => {
      const fallback = nextDefaults[pageState.slug] ?? (fallbackTemplate ? cloneAboutPage(fallbackTemplate) : null);
      const source = pageState.draftPage ?? pageState.publishedPage ?? fallback;
      if (!source) {
        return;
      }
      const normalized = cloneAboutPage(source);
      normalized.slug = pageState.slug;
      if (!normalized.navLabel.trim()) {
        normalized.navLabel = labelFromSlug(pageState.slug);
      }
      nextDrafts[pageState.slug] = cloneAboutPage(normalized);
      nextSavedDrafts[pageState.slug] = cloneAboutPage(normalized);
      nextPublishedPages[pageState.slug] = pageState.publishedPage ? cloneAboutPage(pageState.publishedPage) : null;
      nextPageStates[pageState.slug] = pageState;
    });

    const nextCatalogDrafts: Record<AboutPageSlug, AboutCatalogState> = {};
    const nextSavedCatalogDrafts: Record<AboutPageSlug, AboutCatalogState> = {};
    const nextCatalogPublished: Record<AboutPageSlug, AboutCatalogState> = {};
    editorState.catalog.forEach((entry) => {
      nextCatalogDrafts[entry.slug] = { ...entry.draft };
      nextSavedCatalogDrafts[entry.slug] = { ...entry.draft };
      nextCatalogPublished[entry.slug] = { ...entry.published };
    });

    setDefaults(nextDefaults);
    setDrafts(nextDrafts);
    setSavedDrafts(nextSavedDrafts);
    setPublishedPages(nextPublishedPages);
    setPageStateBySlug(nextPageStates);
    setCatalogDrafts(nextCatalogDrafts);
    setSavedCatalogDrafts(nextSavedCatalogDrafts);
    setCatalogPublished(nextCatalogPublished);

    const availableSlugs = Object.keys(nextDrafts);
    if (!availableSlugs.includes(slug)) {
      setSlug(availableSlugs.includes('about') ? 'about' : (availableSlugs[0] ?? 'about'));
    }
    if (!(newPageTemplateSlug in nextDrafts)) {
      setNewPageTemplateSlug(nextDrafts.about ? 'about' : (Object.keys(nextDrafts)[0] ?? 'about'));
    }
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const state = await adminFetch<AdminAboutEditorState>('/api/admin/about/v2/editor-state');
      applyEditorState(state);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setRenameSlugInput(slug); }, [slug]);

  const draft = drafts?.[slug] ?? null;
  const deferred = useDeferredValue(draft);
  const draftCatalog = catalogDrafts?.[slug] ?? null;
  const pageState = pageStateBySlug?.[slug] ?? null;

  const pageSlugs = useMemo(() => {
    const allSlugs = new Set<string>();
    Object.keys(drafts ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(catalogDrafts ?? {}).forEach((key) => allSlugs.add(key));
    return [...allSlugs].sort((a, b) => {
      if (a === 'about' && b !== 'about') return -1;
      if (b === 'about' && a !== 'about') return 1;
      const aOrder = catalogDrafts?.[a]?.order ?? 0;
      const bOrder = catalogDrafts?.[b]?.order ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });
  }, [drafts, catalogDrafts]);

  const dirtySet = useMemo(() => {
    const next = new Set<AboutPageSlug>();
    const allSlugs = new Set<string>();
    Object.keys(drafts ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(savedDrafts ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(catalogDrafts ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(savedCatalogDrafts ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(catalogPublished ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(publishedPages ?? {}).forEach((key) => allSlugs.add(key));
    Object.keys(pageStateBySlug ?? {}).forEach((key) => allSlugs.add(key));

    if (allSlugs.size === 0) return next;

    allSlugs.forEach((pageSlug) => {
      const localDraft = drafts?.[pageSlug];
      const savedDraft = savedDrafts?.[pageSlug];
      const publishedPage = publishedPages?.[pageSlug] ?? null;
      const localCatalog = catalogDrafts?.[pageSlug];
      const savedCatalog = savedCatalogDrafts?.[pageSlug];
      const publishedCatalogState = catalogPublished?.[pageSlug];
      const state = pageStateBySlug?.[pageSlug];

      const hasUnsyncedDraft = JSON.stringify(localDraft) !== JSON.stringify(savedDraft);
      const hasUnsyncedCatalog = JSON.stringify(localCatalog) !== JSON.stringify(savedCatalog);

      const hasPublishedDiff =
        JSON.stringify(savedDraft ?? null) !== JSON.stringify(publishedPage) ||
        Boolean(state?.draftDeleted) !== Boolean(state?.publishedDeleted) ||
        JSON.stringify(savedCatalog ?? null) !== JSON.stringify(publishedCatalogState ?? null);

      if (hasUnsyncedDraft || hasUnsyncedCatalog || hasPublishedDiff) {
        next.add(pageSlug);
      }
    });

    return next;
  }, [drafts, savedDrafts, publishedPages, pageStateBySlug, catalogDrafts, savedCatalogDrafts, catalogPublished]);

  const dirty = dirtySet.has(slug);
  const globalChangedCount = dirtySet.size;

  const upPage = (fn: (p: AboutPageContent) => AboutPageContent) =>
    setDrafts((d) => d ? { ...d, [slug]: fn(cloneAboutPage(d[slug])) } : d);
  const upHero = (k: keyof AboutPageContent['hero'], v: string) =>
    upPage((p) => ({ ...p, hero: { ...p.hero, [k]: v } }));
  const upSec = (i: number, fn: (s: AboutSection) => AboutSection) =>
    upPage((p) => ({ ...p, sections: p.sections.map((s, j) => j === i ? fn(s) : s) }));
  const moveSec = (i: number, d: -1 | 1) =>
    upPage((p) => ({ ...p, sections: reorder(p.sections, i, d) }));
  const removeSec = (i: number) =>
    upPage((p) => ({ ...p, sections: p.sections.filter((_, j) => j !== i) }));

  const upCatalog = (fn: (c: AboutCatalogState) => AboutCatalogState) =>
    setCatalogDrafts((current) => {
      if (!current) return current;
      const entry = current[slug];
      if (!entry) return current;
      return { ...current, [slug]: fn({ ...entry }) };
    });

  useEffect(() => {
    if (!draft || !savedDrafts) return;
    const saved = savedDrafts[slug];
    if (!saved || JSON.stringify(saved) === JSON.stringify(draft)) return;

    const timer = window.setTimeout(async () => {
      setAutosavingDraft(true);
      try {
        const payload = cloneAboutPage(draft);
        payload.slug = slug;
        const savedResponse = await adminFetch<{ slug: string; draftPage: AboutPageContent; draftUpdatedAt: string }>(
          `/api/admin/about/v2/draft/pages/${slug}`,
          { method: 'PUT', body: JSON.stringify(payload) }
        );
        setSavedDrafts((prev) => prev ? { ...prev, [slug]: cloneAboutPage(savedResponse.draftPage) } : prev);
        setPageStateBySlug((prev) => prev ? {
          ...prev,
          [slug]: {
            ...(prev[slug] ?? {
              slug,
              isStarter: ABOUT_PAGE_SLUGS.includes(slug as any),
              draftPage: savedResponse.draftPage,
              publishedPage: publishedPages?.[slug] ?? null,
              draftDeleted: false,
              publishedDeleted: false,
              draftUpdatedAt: savedResponse.draftUpdatedAt,
              publishedUpdatedAt: null,
              pageChanged: true
            }),
            draftDeleted: false,
            draftUpdatedAt: savedResponse.draftUpdatedAt
          }
        } : prev);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to auto-save draft');
      } finally {
        setAutosavingDraft(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [slug, draft, savedDrafts, publishedPages]);

  useEffect(() => {
    if (!draftCatalog || !savedCatalogDrafts) return;
    const saved = savedCatalogDrafts[slug];
    if (!saved || JSON.stringify(saved) === JSON.stringify(draftCatalog)) return;

    const timer = window.setTimeout(async () => {
      setAutosavingCatalog(true);
      try {
        const savedResponse = await adminFetch<{ slug: string; draft: AboutCatalogState; draftDeleted: boolean }>(
          `/api/admin/about/v2/draft/catalog/${slug}`,
          { method: 'PATCH', body: JSON.stringify(draftCatalog) }
        );
        setSavedCatalogDrafts((prev) => prev ? { ...prev, [slug]: { ...savedResponse.draft } } : prev);
        setCatalogDrafts((prev) => prev ? { ...prev, [slug]: { ...savedResponse.draft } } : prev);
        setPageStateBySlug((prev) => prev ? {
          ...prev,
          [slug]: {
            ...(prev[slug] ?? {
              slug,
              isStarter: ABOUT_PAGE_SLUGS.includes(slug as any),
              draftPage: drafts?.[slug] ?? null,
              publishedPage: publishedPages?.[slug] ?? null,
              draftDeleted: savedResponse.draftDeleted,
              publishedDeleted: false,
              draftUpdatedAt: null,
              publishedUpdatedAt: null,
              pageChanged: true
            }),
            draftDeleted: savedResponse.draftDeleted
          }
        } : prev);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to auto-save catalog');
      } finally {
        setAutosavingCatalog(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [slug, draftCatalog, savedCatalogDrafts, drafts, publishedPages]);

  const flushCurrentDraft = async () => {
    if (!draft || !savedDrafts) return;
    const saved = savedDrafts[slug];
    if (saved && JSON.stringify(saved) === JSON.stringify(draft)) return;
    const payload = cloneAboutPage(draft);
    payload.slug = slug;
    const response = await adminFetch<{ slug: string; draftPage: AboutPageContent; draftUpdatedAt: string }>(
      `/api/admin/about/v2/draft/pages/${slug}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    );
    setSavedDrafts((prev) => prev ? { ...prev, [slug]: cloneAboutPage(response.draftPage) } : prev);
    setPageStateBySlug((prev) => prev ? {
      ...prev,
      [slug]: {
        ...(prev[slug] ?? {
          slug,
          isStarter: ABOUT_PAGE_SLUGS.includes(slug as any),
          draftPage: response.draftPage,
          publishedPage: publishedPages?.[slug] ?? null,
          draftDeleted: false,
          publishedDeleted: false,
          draftUpdatedAt: response.draftUpdatedAt,
          publishedUpdatedAt: null,
          pageChanged: true
        }),
        draftDeleted: false,
        draftUpdatedAt: response.draftUpdatedAt
      }
    } : prev);
  };

  const flushCurrentCatalog = async () => {
    if (!draftCatalog || !savedCatalogDrafts) return;
    const saved = savedCatalogDrafts[slug];
    if (saved && JSON.stringify(saved) === JSON.stringify(draftCatalog)) return;
    const response = await adminFetch<{ slug: string; draft: AboutCatalogState; draftDeleted: boolean }>(
      `/api/admin/about/v2/draft/catalog/${slug}`,
      { method: 'PATCH', body: JSON.stringify(draftCatalog) }
    );
    setSavedCatalogDrafts((prev) => prev ? { ...prev, [slug]: { ...response.draft } } : prev);
    setCatalogDrafts((prev) => prev ? { ...prev, [slug]: { ...response.draft } } : prev);
    setPageStateBySlug((prev) => prev ? {
      ...prev,
      [slug]: {
        ...(prev[slug] ?? {
          slug,
          isStarter: ABOUT_PAGE_SLUGS.includes(slug as any),
          draftPage: drafts?.[slug] ?? null,
          publishedPage: publishedPages?.[slug] ?? null,
          draftDeleted: response.draftDeleted,
          publishedDeleted: false,
          draftUpdatedAt: null,
          publishedUpdatedAt: null,
          pageChanged: true
        }),
        draftDeleted: response.draftDeleted
      }
    } : prev);
  };

  const setPageEnabled = async (targetSlug: AboutPageSlug, enabled: boolean) => {
    const current = catalogDrafts?.[targetSlug];
    if (!current) return;
    const next = { ...current, enabled, deleted: false };
    setCatalogDrafts((prev) => prev ? { ...prev, [targetSlug]: next } : prev);
    setSavedCatalogDrafts((prev) => prev ? { ...prev, [targetSlug]: next } : prev);
    try {
      await adminFetch(`/api/admin/about/v2/draft/catalog/${targetSlug}`, {
        method: 'PATCH',
        body: JSON.stringify(next)
      });
      setNotice(enabled ? `${labelFromSlug(targetSlug)} enabled.` : `${labelFromSlug(targetSlug)} disabled.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update page visibility');
      await load();
    }
  };

  const movePageOrder = async (targetSlug: AboutPageSlug, direction: -1 | 1) => {
    if (!catalogDrafts || targetSlug === 'about') return;
    const movable = pageSlugs.filter((candidate) => candidate !== 'about');
    const index = movable.indexOf(targetSlug);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= movable.length) return;
    const swapSlug = movable[nextIndex];
    const current = catalogDrafts[targetSlug];
    const swap = catalogDrafts[swapSlug];
    if (!current || !swap) return;

    const nextTarget = { ...current, order: swap.order };
    const nextSwap = { ...swap, order: current.order };
    setCatalogDrafts((prev) => prev ? { ...prev, [targetSlug]: nextTarget, [swapSlug]: nextSwap } : prev);
    setSavedCatalogDrafts((prev) => prev ? { ...prev, [targetSlug]: nextTarget, [swapSlug]: nextSwap } : prev);

    try {
      await Promise.all([
        adminFetch(`/api/admin/about/v2/draft/catalog/${targetSlug}`, { method: 'PATCH', body: JSON.stringify(nextTarget) }),
        adminFetch(`/api/admin/about/v2/draft/catalog/${swapSlug}`, { method: 'PATCH', body: JSON.stringify(nextSwap) })
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder pages');
      await load();
    }
  };

  const publishAll = async () => {
    if (!draft) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await flushCurrentDraft();
      await flushCurrentCatalog();
      const result = await adminFetch<{ success: boolean; editorState: AdminAboutEditorState }>('/api/admin/about/v2/publish', {
        method: 'POST'
      });
      applyEditorState(result.editorState);
      setNotice('All draft changes published.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish all changes');
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminFetch<{ success: boolean; editorState: AdminAboutEditorState }>('/api/admin/about/v2/draft/reset', {
        method: 'POST',
        body: JSON.stringify({ slug })
      });
      applyEditorState(result.editorState);
      setNotice('Draft reset to published.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset draft');
    } finally {
      setSaving(false);
    }
  };

  const loadDefaults = async () => {
    if (!defaults) return;
    const source = defaults[slug] ?? defaults.about ?? Object.values(defaults)[0];
    if (!source) return;
    const nextPage = cloneAboutPage(source);
    nextPage.slug = slug;
    if (!defaults[slug]) {
      nextPage.navLabel = labelFromSlug(slug);
    }
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/about/v2/draft/pages/${slug}`, {
        method: 'PUT',
        body: JSON.stringify(nextPage)
      });
      if (catalogDrafts?.[slug]) {
        await adminFetch(`/api/admin/about/v2/draft/catalog/${slug}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...catalogDrafts[slug], deleted: false, enabled: slug !== 'about' })
        });
      }
      await load();
      setNotice('Default content restored to draft.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load defaults');
    } finally {
      setSaving(false);
    }
  };

  const createPageDraft = async () => {
    if (!drafts || !defaults) return;
    const normalizedSlug = normalizeSlugInput(newPageSlug);
    if (!normalizedSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
      setError('Slug must use lowercase letters, numbers, and hyphens only.');
      return;
    }
    if (drafts[normalizedSlug]) {
      setError('A page with that slug already exists.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await adminFetch('/api/admin/about/v2/draft/pages', {
        method: 'POST',
        body: JSON.stringify({ slug: normalizedSlug, templateSlug: newPageTemplateSlug })
      });
      await load();
      setSlug(normalizedSlug);
      setRenameSlugInput(normalizedSlug);
      setNewPageSlug('');
      setNotice(`Draft page "${normalizedSlug}" created.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create draft page');
    } finally {
      setSaving(false);
    }
  };

  const renamePageSlug = async () => {
    if (!draft || !draftCatalog || !drafts) return;
    const nextSlug = normalizeSlugInput(renameSlugInput);
    if (!nextSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
      setError('Slug must use lowercase letters, numbers, and hyphens only.');
      return;
    }
    if (nextSlug === slug) {
      setNotice('Slug is unchanged.');
      return;
    }
    if (drafts[nextSlug]) {
      setError('A page with that slug already exists.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await flushCurrentDraft();
      await flushCurrentCatalog();

      const renamed = cloneAboutPage(draft);
      renamed.slug = nextSlug;
      if (!renamed.navLabel.trim()) renamed.navLabel = labelFromSlug(nextSlug);

      await adminFetch(`/api/admin/about/v2/draft/pages/${nextSlug}`, {
        method: 'PUT',
        body: JSON.stringify(renamed)
      });

      await adminFetch(`/api/admin/about/v2/draft/catalog/${nextSlug}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...draftCatalog, deleted: false })
      });

      await adminFetch(`/api/admin/about/v2/draft/pages/${slug}`, {
        method: 'DELETE'
      });

      await load();
      setSlug(nextSlug);
      setRenameSlugInput(nextSlug);
      setNotice(`Slug changed from "${slug}" to "${nextSlug}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename page slug');
    } finally {
      setSaving(false);
    }
  };

  const deletePage = async () => {
    if (!drafts) return;
    const isStarterSlug = ABOUT_PAGE_SLUGS.includes(slug as any);
    const confirmed = confirm(
      isStarterSlug
        ? `Stage delete for starter page "${ABOUT_PAGE_LABELS[slug] ?? labelFromSlug(slug)}"?`
        : `Stage delete for page "${slug}"?`
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/api/admin/about/v2/draft/pages/${slug}`, { method: 'DELETE' });
      await load();
      setNotice(`Delete staged for "${slug}". Publish all to apply publicly.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stage page deletion');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !drafts || !defaults || !draft || !pageStateBySlug || !catalogDrafts || !savedDrafts || !savedCatalogDrafts || !catalogPublished) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-stone-400">
        {error
          ? <><AlertCircle className="h-4 w-4 text-red-500" /><span className="text-sm text-red-600">{error}</span></>
          : <><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading editor…</span></>}
      </div>
    );
  }

  const published = formatUpdatedAt(pageState?.publishedUpdatedAt ?? null);
  const draftDeleted = pageState?.draftDeleted ?? false;
  const publishedDeleted = pageState?.publishedDeleted ?? false;

  const autoCardItems = pageSlugs
    .filter((pageSlug) => pageSlug !== 'about')
    .map((pageSlug) => ({ slug: pageSlug, catalog: catalogDrafts[pageSlug] }))
    .filter((entry): entry is { slug: string; catalog: AboutCatalogState } => Boolean(entry.catalog))
    .filter((entry) => !entry.catalog.deleted && entry.catalog.enabled)
    .sort((a, b) => (a.catalog.order - b.catalog.order) || a.slug.localeCompare(b.slug))
    .map((entry) => ({
      hidden: false,
      title: entry.catalog.cardTitle,
      description: entry.catalog.cardDescription,
      href: publicPathForSlug(entry.slug),
      image: entry.catalog.cardImage
    }));

  const previewDraft = (() => {
    if (!draft || slug !== 'about') return draft;
    const next = cloneAboutPage(draft);
    const linkGridIndex = next.sections.findIndex((section) => section.type === 'linkGrid');
    if (linkGridIndex >= 0 && next.sections[linkGridIndex]?.type === 'linkGrid') {
      const linkGrid = next.sections[linkGridIndex] as AboutLinkGridSection;
      next.sections[linkGridIndex] = { ...linkGrid, items: autoCardItems };
      return next;
    }
    next.sections.splice(1, 0, {
      id: 'pathways',
      type: 'linkGrid',
      hidden: false,
      eyebrow: 'Find Your Place',
      heading: 'Get Involved',
      items: autoCardItems
    });
    return next;
  })();

  // ─── Section renderers ──────────────────────────────────────────────────────

  const renderSection = (section: AboutSection, si: number) => {
    const label = SECTION_TYPE_LABELS[section.type] ?? section.type;
    const shellProps = {
      id: section.id, index: si + 1, label,
      hidden: section.hidden === true,
      onToggleHidden: () => upSec(si, (s) => ({ ...s, hidden: s.hidden !== true })),
      isFirst: si === 0, isLast: si === draft.sections.length - 1,
      onMoveUp: () => moveSec(si, -1),
      onMoveDown: () => moveSec(si, 1),
      onRemove: () => removeSec(si),
    };
    const header = (
      <Row2>
        <Field label="Eyebrow"><input value={(section as any).eyebrow ?? ''} onChange={(e) => upSec(si, (s) => ({ ...s, eyebrow: e.target.value }))} className={inputClass} /></Field>
        <Field label="Heading"><input value={(section as any).heading ?? ''} onChange={(e) => upSec(si, (s) => ({ ...s, heading: e.target.value }))} className={inputClass} /></Field>
      </Row2>
    );

    switch (section.type) {
      case 'story': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Lead line"><input value={section.lead} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutStorySection), lead: e.target.value }))} className={inputClass} /></Field>
          <Row2>
            <Field label="Pull quote"><textarea value={section.quote ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutStorySection), quote: e.target.value }))} className={taClass} /></Field>
            <Field label="Attribution"><input value={section.quoteAttribution ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutStorySection), quoteAttribution: e.target.value }))} className={inputClass} /></Field>
          </Row2>
          <StringList label="Paragraphs" values={section.paragraphs} addLabel="Add paragraph"
            onChange={(v) => upSec(si, (s) => ({ ...(s as AboutStorySection), paragraphs: v }))} />
        </SectionShell>
      );

      case 'linkGrid': {
        if (slug === 'about') {
          return (
            <SectionShell key={section.id} {...shellProps}>
              {header}
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Get Involved cards are auto-synced from page catalog metadata (title, description, image, order, enabled).
              </div>
              <div className="space-y-3">
                {autoCardItems.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-stone-200 py-3 text-center text-xs text-stone-400">
                    No enabled pages to show yet.
                  </p>
                ) : (
                  autoCardItems.map((item, ii) => (
                    <div key={`${section.id}-auto-link-${ii}`} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                      <p className="mb-3 text-xs font-semibold text-stone-500">Card {ii + 1}{item.title ? ` — ${item.title}` : ''}</p>
                      <Row2>
                        <Field label="Title"><input value={item.title} readOnly className={inputClass} /></Field>
                        <Field label="URL"><input value={item.href} readOnly className={inputClass} /></Field>
                      </Row2>
                      <Field label="Description"><textarea value={item.description} readOnly className={taClass} /></Field>
                    </div>
                  ))
                )}
              </div>
            </SectionShell>
          );
        }

        return (
          <SectionShell key={section.id} {...shellProps}>
            {header}
            <div className="space-y-3">
              {section.items.map((item, ii) => (
                <SubItem
                  key={`${section.id}-link-${ii}`}
                  title={`Card ${ii + 1}${item.title ? ` — ${item.title}` : ''}${item.hidden ? ' (hidden)' : ''}`}
                  index={ii}
                  length={section.items.length}
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
              <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutLinkGridSection), items: [...(s as AboutLinkGridSection).items, { hidden: false, title: '', description: '', href: '/about' }] }))}>
                <Link2 className="h-3.5 w-3.5" /> Add card
              </AddBtn>
            </div>
          </SectionShell>
        );
      }

      case 'people': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <div className="space-y-3">
            {section.items.map((person, ii) => (
              <SubItem key={`${section.id}-person-${ii}`} title={`Person ${ii + 1}${person.name ? ` — ${person.name}` : ''}`} index={ii} length={section.items.length}
                onMove={(d) => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: reorder((s as AboutPeopleSection).items, ii, d) }))}
                onRemove={() => upSec(si, (s) => ({ ...(s as AboutPeopleSection), items: (s as AboutPeopleSection).items.filter((_, j) => j !== ii) }))}>
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
            {header}
            <Field label="Description"><textarea value={hs.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), description: e.target.value }))} className={taClass} /></Field>
            <div className="space-y-3">
              <FieldLabel>Performances</FieldLabel>
              {hs.items.map((item, ii) => (
                <SubItem key={`${hs.id}-history-${ii}`} title={`${item.year || 'Performance'} ${ii + 1}${item.title ? ` — ${item.title}` : ''}`} index={ii} length={hs.items.length}
                  onMove={(d) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: reorder((s as AboutHistorySection).items, ii, d) }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.filter((_, j) => j !== ii) }))}>
                  <Row2>
                    <Field label="Year"><input value={item.year} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, year: e.target.value } : x) }))} className={inputClass} /></Field>
                    <Field label="Title"><input value={item.title} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, title: e.target.value } : x) }))} className={inputClass} /></Field>
                  </Row2>
                  <Field label="Description"><textarea value={item.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, description: e.target.value } : x) }))} className={taClass} /></Field>
                  <ImageField label="Performance image" value={item.image}
                    onChange={(img) => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: (s as AboutHistorySection).items.map((x, j) => j === ii ? { ...x, image: img ?? { url: '', alt: '' } } : x) }))} />
                </SubItem>
              ))}
              <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutHistorySection), items: [...(s as AboutHistorySection).items, { year: '', title: '', description: '', image: { url: '', alt: '' } } satisfies AboutHistoryItem] }))}>
                <ImagePlus className="h-3.5 w-3.5" /> Add performance
              </AddBtn>
            </div>
          </SectionShell>
        );
      }

      case 'calendar': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Description"><textarea value={(section as any).description ?? ''} onChange={(e) => upSec(si, (s) => ({ ...s, description: e.target.value } as AboutSection))} className={taClass} /></Field>
        </SectionShell>
      );

      case 'featureGrid': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Intro"><textarea value={section.intro} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), intro: e.target.value }))} className={taClass} /></Field>
          <div className="space-y-3">
            {section.items.map((item, ii) => (
              <SubItem key={`${section.id}-feature-${ii}`} title={`Card ${ii + 1}${item.title ? ` — ${item.title}` : ''}`} index={ii} length={section.items.length}
                onMove={(d) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: reorder((s as AboutFeatureGridSection).items, ii, d) }))}
                onRemove={() => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: (s as AboutFeatureGridSection).items.filter((_, j) => j !== ii) }))}>
                <Field label="Title"><input value={item.title} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: (s as AboutFeatureGridSection).items.map((x, j) => j === ii ? { ...x, title: e.target.value } : x) }))} className={inputClass} /></Field>
                <Field label="Description"><textarea value={item.description} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: (s as AboutFeatureGridSection).items.map((x, j) => j === ii ? { ...x, description: e.target.value } : x) }))} className={taClass} /></Field>
              </SubItem>
            ))}
            <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutFeatureGridSection), items: [...(s as AboutFeatureGridSection).items, { title: '', description: '' }] }))}>
              <FilePenLine className="h-3.5 w-3.5" /> Add card
            </AddBtn>
          </div>
        </SectionShell>
      );

      case 'splitFeature': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Lead"><textarea value={section.lead} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), lead: e.target.value }))} className={taClass} /></Field>
          <StringList label="Body paragraphs" values={section.body} addLabel="Add paragraph"
            onChange={(v) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), body: v }))} />
          <StringList label="Bullet points" values={section.bullets} addLabel="Add bullet"
            onChange={(v) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), bullets: v }))} />
          <Row2>
            <Field label="Callout title"><input value={section.calloutTitle ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), calloutTitle: e.target.value }))} className={inputClass} /></Field>
            <Field label="Callout body"><input value={section.calloutBody ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), calloutBody: e.target.value }))} className={inputClass} /></Field>
          </Row2>
          <div className="space-y-3">
            <FieldLabel>Images</FieldLabel>
            {section.images.map((img, ii) => (
              <SubItem key={`${section.id}-image-${ii}`} title={`Image ${ii + 1}`} index={ii} length={section.images.length}
                onMove={(d) => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), images: reorder((s as AboutSplitFeatureSection).images, ii, d) }))}
                onRemove={() => upSec(si, (s) => ({ ...(s as AboutSplitFeatureSection), images: (s as AboutSplitFeatureSection).images.filter((_, j) => j !== ii) }))}>
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

      case 'testimonial': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Quote"><textarea value={section.quote} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutTestimonialSection), quote: e.target.value }))} className={taClass} /></Field>
          <Field label="Attribution"><input value={section.attribution} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutTestimonialSection), attribution: e.target.value }))} className={inputClass} /></Field>
          <ImageField label="Feature image" value={section.image}
            onChange={(img) => upSec(si, (s) => ({ ...(s as AboutTestimonialSection), image: img ?? { url: '', alt: '' } }))} />
        </SectionShell>
      );

      case 'listPanel': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Body"><textarea value={section.body} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), body: e.target.value }))} className={taClass} /></Field>
          <Row2>
            <Field label="Panel title"><input value={section.panelTitle} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), panelTitle: e.target.value }))} className={inputClass} /></Field>
            <Field label="Panel body"><input value={section.panelBody} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), panelBody: e.target.value }))} className={inputClass} /></Field>
          </Row2>
          <StringList label="Panel items" values={section.items} addLabel="Add item"
            onChange={(v) => upSec(si, (s) => ({ ...(s as AboutListPanelSection), items: v }))} />
        </SectionShell>
      );

      case 'cta': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <Field label="Body"><textarea value={section.body} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutCtaSection), body: e.target.value }))} className={taClass} /></Field>
          <div className="grid gap-3 xl:grid-cols-2">
            <ActionField label="Primary button" value={section.primary}
              onChange={(v) => upSec(si, (s) => ({ ...(s as AboutCtaSection), primary: v }))} />
            {section.secondary
              ? <ActionField label="Secondary button" value={section.secondary}
                  onChange={(v) => upSec(si, (s) => ({ ...(s as AboutCtaSection), secondary: v }))}
                  onRemove={() => upSec(si, (s) => ({ ...(s as AboutCtaSection), secondary: undefined }))} />
              : <div className="flex items-start pt-6">
                  <AddBtn onClick={() => upSec(si, (s) => ({ ...(s as AboutCtaSection), secondary: { label: '', href: '/about' } }))}>
                    <Link2 className="h-3.5 w-3.5" /> Add secondary button
                  </AddBtn>
                </div>}
          </div>
          <Row2>
            <Field label="Contact label"><input value={section.contactLabel ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutCtaSection), contactLabel: e.target.value }))} className={inputClass} /></Field>
            <Field label="Contact value"><input value={section.contactValue ?? ''} onChange={(e) => upSec(si, (s) => ({ ...(s as AboutCtaSection), contactValue: e.target.value }))} className={inputClass} /></Field>
          </Row2>
        </SectionShell>
      );

      default: return null;
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">Content Editor</p>
          <h1 className="mt-2 text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
            About Pages
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-stone-600">
            Drafts are persisted to the server. Publish All Changes applies content, catalog metadata, and staged deletions together.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
            {globalChangedCount} changed
          </span>
          {(autosavingDraft || autosavingCatalog) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving draft
            </span>
          )}
          <a href={publicPathForSlug(slug)} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            <ExternalLink className="h-4 w-4" /> View live
          </a>
          <button type="button" onClick={() => setShowPreview((p) => !p)}
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${showPreview ? 'border-red-300 bg-red-50 text-red-700' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
      </div>

      {/* ── Feedback banners ── */}
      {error  && <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}<button onClick={() => setError(null)} className="ml-auto text-rose-400 hover:text-rose-600"><X className="h-4 w-4" /></button></div>}
      {notice && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}<button onClick={() => setNotice(null)} className="ml-auto text-emerald-400 hover:text-emerald-600"><X className="h-4 w-4" /></button></div>}

      {/* ── Two-column layout (mirrors AdminPagesPage) ── */}
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">

        {/* ── Sidebar: page switcher + actions ── */}
        <aside className="space-y-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="space-y-2">
              {pageSlugs.map((s) => {
                const active = s === slug;
                const d = dirtySet.has(s);
                const enabled = catalogDrafts?.[s]?.enabled ?? (s !== 'about');
                const stagedDelete = pageStateBySlug?.[s]?.draftDeleted ?? false;
                const publishedGone = pageStateBySlug?.[s]?.publishedDeleted ?? false;
                return (
                  <div
                    key={s}
                    className={`w-full rounded-2xl border px-4 py-4 transition ${active ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white hover:bg-stone-50'}`}
                  >
                    <button
                      type="button"
                      onClick={() => { setSlug(s); setNotice(null); setError(null); }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-stone-900">{ABOUT_PAGE_LABELS[s] ?? drafts?.[s]?.navLabel ?? labelFromSlug(s)}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.15em] text-stone-500">{publicPathForSlug(s)}</p>
                        </div>
                        {d && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unsaved changes" />}
                      </div>
                    </button>
                    <div className="mt-3 flex items-center justify-between border-t border-stone-200/70 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                        {stagedDelete
                          ? 'Draft Deleted'
                          : enabled ? 'Page On' : 'Page Off'}
                      </p>
                      <div className="flex items-center gap-1">
                        {s !== 'about' && (
                          <>
                            <IconBtn onClick={() => void movePageOrder(s, -1)} title="Move up">
                              <ArrowUp className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn onClick={() => void movePageOrder(s, 1)} title="Move down">
                              <ArrowDown className="h-3.5 w-3.5" />
                            </IconBtn>
                          </>
                        )}
                        {s !== 'about' && (
                          <button
                            type="button"
                            onClick={() => void setPageEnabled(s, !enabled)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                              enabled
                                ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {enabled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            {enabled ? 'Turn Off' : 'Turn On'}
                          </button>
                        )}
                        {publishedGone && (
                          <span className="rounded-full bg-stone-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                            Live Deleted
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Add Page</p>
            <div className="space-y-2">
              <input
                value={newPageSlug}
                onChange={(event) => setNewPageSlug(normalizeSlugInput(event.target.value))}
                placeholder="new-page-slug"
                className={inputClass}
              />
              <select
                value={newPageTemplateSlug}
                onChange={(event) => setNewPageTemplateSlug(event.target.value)}
                className={inputClass}
              >
                {(pageSlugs.length > 0 ? pageSlugs : ['about']).map((templateSlug) => (
                  <option key={templateSlug} value={templateSlug}>
                    Template: {ABOUT_PAGE_LABELS[templateSlug] ?? defaults?.[templateSlug]?.navLabel ?? labelFromSlug(templateSlug)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={createPageDraft}
              disabled={saving || !newPageSlug}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              <FilePenLine className="h-4 w-4" /> Create draft page
            </button>
            <p className="text-xs text-stone-500">Publish to make it live at <span className="font-semibold">{newPageSlug ? `/${newPageSlug}` : '/your-slug'}</span>.</p>
          </div>

          {/* Action card */}
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Page status</p>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${dirty ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-stone-100 text-stone-500'}`}>
                {dirty ? 'Changed' : 'Up to date'}
              </span>
            </div>
            <p className="text-xs text-stone-400">
              {draftDeleted ? 'Draft state: Deleted' : 'Draft state: Active'}
              {` · `}
              {publishedDeleted ? 'Published state: Deleted' : (published ? `Published ${published}` : 'Never published')}
            </p>
            <div className="space-y-2 rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Page slug</p>
              <input
                value={renameSlugInput}
                onChange={(event) => setRenameSlugInput(normalizeSlugInput(event.target.value))}
                className={inputClass}
                placeholder="page-slug"
              />
              <button
                type="button"
                onClick={() => void renamePageSlug()}
                disabled={saving || !renameSlugInput}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
              >
                <FilePenLine className="h-3.5 w-3.5" /> Change slug
              </button>
            </div>
            {draftCatalog && slug !== 'about' && (
              <div className="space-y-2 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Get Involved Card</p>
                <Field label="Card title">
                  <input value={draftCatalog.cardTitle} onChange={(e) => upCatalog((c) => ({ ...c, cardTitle: e.target.value, deleted: false }))} className={inputClass} />
                </Field>
                <Field label="Card description">
                  <textarea value={draftCatalog.cardDescription} onChange={(e) => upCatalog((c) => ({ ...c, cardDescription: e.target.value, deleted: false }))} className={taClass} />
                </Field>
                <ImageField
                  label="Card image"
                  value={draftCatalog.cardImage}
                  optional
                  onChange={(img) => upCatalog((c) => ({ ...c, cardImage: img, deleted: false }))}
                />
              </div>
            )}
            <div className="space-y-2 pt-1">
              <button type="button" onClick={() => void publishAll()} disabled={saving || globalChangedCount === 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Publishing…' : 'Publish All Changes'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void revert()} disabled={saving}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" /> Revert
                </button>
                <button type="button" onClick={() => void loadDefaults()} disabled={saving}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40">
                  <RefreshCw className="h-3.5 w-3.5" /> Defaults
                </button>
              </div>
              <button
                type="button"
                onClick={() => void deletePage()}
                disabled={saving}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete page
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main editor + optional preview ── */}
        <div className={`gap-6 ${showPreview ? 'grid xl:grid-cols-2' : ''}`}>

          {/* Editor column */}
          <div className="space-y-4">

            {/* Hero card */}
            <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-5 border-b border-stone-100 pb-5">
                <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Page Header</h2>
                <p className="mt-1 text-sm text-stone-600">Navigation label and hero section shown at the top of the page.</p>
              </div>
              <div className="space-y-4">
                <Row2>
                  <Field label="Navigation label">
                    <input value={draft.navLabel} onChange={(e) => upPage((p) => ({ ...p, navLabel: e.target.value }))} className={inputClass} />
                  </Field>
                  <Field label="Eyebrow">
                    <input value={draft.hero.eyebrow} onChange={(e) => upHero('eyebrow', e.target.value)} className={inputClass} />
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Title">
                    <input value={draft.hero.title} onChange={(e) => upHero('title', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Accent text">
                    <input value={draft.hero.accent} onChange={(e) => upHero('accent', e.target.value)} className={inputClass} />
                  </Field>
                </Row2>
                <Field label="Description">
                  <textarea value={draft.hero.description} onChange={(e) => upHero('description', e.target.value)} className={taClass} />
                </Field>
              </div>
            </div>

            {/* Content sections */}
            {draft.sections.map((section, si) => renderSection(section, si))}

            {/* Unsaved nudge */}
            {dirty && (
              <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-amber-700">This page has draft changes.</p>
                <button type="button" onClick={() => void publishAll()} disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                  <Save className="h-4 w-4" /> Publish all
                </button>
              </div>
            )}
          </div>

          {/* Preview column */}
          {showPreview && (
            <div>
              <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm xl:sticky xl:top-6">
                <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Live Preview</p>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-600 ring-1 ring-emerald-200">Rendering</span>
                </div>
                <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
                  {previewDraft ? <AboutPageRenderer page={previewDraft} preview previewMode="admin" /> : (deferred ? <AboutPageRenderer page={deferred} preview previewMode="admin" /> : null)}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
