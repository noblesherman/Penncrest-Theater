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
  type AboutAction, type AboutCtaSection, type AboutFeatureGridSection,
  type AboutHistoryItem, type AboutHistorySection, type AboutImage,
  type AboutLinkGridSection, type AboutListPanelSection, type AboutPageContent,
  type AboutPageSlug, type AboutPeopleSection, type AboutSection,
  type AboutSplitFeatureSection, type AboutStorySection, type AboutTestimonialSection,
  type AdminAboutPageRecord,
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

function normalizeInternalPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

function isAboutPageEnabled(page: AboutPageContent): boolean {
  return page.sections.some((section) => section.hidden !== true);
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
  const [records, setRecords] = useState<Record<AboutPageSlug, AdminAboutPageRecord> | null>(null);
  const [defaults, setDefaults] = useState<Record<AboutPageSlug, AboutPageContent> | null>(null);
  const [drafts, setDrafts] = useState<Record<AboutPageSlug, AboutPageContent> | null>(null);
  const [slug, setSlug] = useState<AboutPageSlug>('about');
  const [newPageSlug, setNewPageSlug] = useState('');
  const [newPageTemplateSlug, setNewPageTemplateSlug] = useState<AboutPageSlug>('about');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [pages, defs] = await Promise.all([
        adminFetch<AdminAboutPageRecord[]>('/api/admin/about/pages'),
        adminFetch<AboutPageContent[]>('/api/admin/about/pages/defaults'),
      ]);
      const nextRecords = Object.fromEntries(pages.map((r) => [r.page.slug, r])) as Record<AboutPageSlug, AdminAboutPageRecord>;
      const nextDrafts = Object.fromEntries(pages.map((r) => [r.page.slug, cloneAboutPage(r.page)])) as Record<AboutPageSlug, AboutPageContent>;
      const nextDefaults = Object.fromEntries(defs.map((p) => [p.slug, p])) as Record<AboutPageSlug, AboutPageContent>;
      setRecords(nextRecords);
      setDrafts(nextDrafts);
      setDefaults(nextDefaults);
      const availableSlugs = Object.keys(nextDrafts);
      if (!availableSlugs.includes(slug)) {
        setSlug(availableSlugs.includes('about') ? 'about' : (availableSlugs[0] ?? 'about'));
      }
      if (!(newPageTemplateSlug in nextDrafts)) {
        setNewPageTemplateSlug(nextDrafts.about ? 'about' : (Object.keys(nextDrafts)[0] ?? 'about'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const record = records?.[slug] ?? null;
  const draft = drafts?.[slug] ?? null;
  const deferred = useDeferredValue(draft);

  const pageSlugs = useMemo(() => {
    const fromDrafts = drafts ? Object.keys(drafts) : [];
    const combined = new Set<string>([...ABOUT_PAGE_SLUGS, ...fromDrafts]);
    return [...combined].sort((a, b) => {
      const aStarterIndex = ABOUT_PAGE_SLUGS.indexOf(a as any);
      const bStarterIndex = ABOUT_PAGE_SLUGS.indexOf(b as any);
      const aIsStarter = aStarterIndex >= 0;
      const bIsStarter = bStarterIndex >= 0;
      if (aIsStarter && bIsStarter) return aStarterIndex - bStarterIndex;
      if (aIsStarter) return -1;
      if (bIsStarter) return 1;
      return a.localeCompare(b);
    });
  }, [drafts]);

  const dirtySet = useMemo(() => {
    if (!drafts) return new Set<AboutPageSlug>();
    const next = new Set<AboutPageSlug>();
    Object.keys(drafts).forEach((pageSlug) => {
      const draftPage = drafts[pageSlug];
      const recordPage = records?.[pageSlug]?.page;
      if (!recordPage || JSON.stringify(recordPage) !== JSON.stringify(draftPage)) {
        next.add(pageSlug);
      }
    });
    return next;
  }, [records, drafts]);

  const dirty = dirtySet.has(slug);

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

  const setPageEnabled = (targetSlug: AboutPageSlug, enabled: boolean) => {
    setDrafts((current) => {
      if (!current) return current;

      const next = { ...current };
      const targetPage = cloneAboutPage(next[targetSlug]);
      targetPage.sections = targetPage.sections.map((section) => ({ ...section, hidden: !enabled }));
      next[targetSlug] = targetPage;

      if (targetSlug !== 'about') {
        const targetPath = publicPathForSlug(targetSlug);
        const aboutPage = cloneAboutPage(next.about);
        aboutPage.sections = aboutPage.sections.map((section) => {
          if (section.type !== 'linkGrid') {
            return section;
          }

          return {
            ...section,
            items: section.items.map((item) => {
              const normalizedPath = normalizeInternalPath(item.href);
              if (normalizedPath !== targetPath) {
                return item;
              }
              return { ...item, hidden: !enabled };
            })
          };
        });
        next.about = aboutPage;
      }

      return next;
    });

    const label = ABOUT_PAGE_LABELS[targetSlug] ?? drafts?.[targetSlug]?.navLabel ?? labelFromSlug(targetSlug);
    setNotice(enabled ? `${label} turned on.` : `${label} turned off.`);
  };

  const setAllGetInvolvedCardsVisible = (visible: boolean) => {
    setDrafts((current) => {
      if (!current) return current;

      const next = { ...current };
      const aboutPage = cloneAboutPage(next.about);
      aboutPage.sections = aboutPage.sections.map((section) => {
        if (section.type !== 'linkGrid') {
          return section;
        }
        return {
          ...section,
          items: section.items.map((item) => ({ ...item, hidden: !visible }))
        };
      });
      next.about = aboutPage;

      return next;
    });

    setNotice(visible ? 'All Get Involved cards turned on.' : 'All Get Involved cards turned off.');
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const saved = await adminFetch<AdminAboutPageRecord>(`/api/admin/about/pages/${slug}`, {
        method: 'PUT', body: JSON.stringify(draft),
      });
      setRecords((r) => r ? { ...r, [slug]: saved } : r);
      setDrafts((d) => d ? { ...d, [slug]: cloneAboutPage(saved.page) } : d);
      setNotice('Published successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    if (!drafts) return;
    const stored = records?.[slug];
    if (stored) {
      setDrafts((d) => d ? { ...d, [slug]: cloneAboutPage(stored.page) } : d);
      setNotice('Changes reverted.');
      return;
    }

    setDrafts((current) => {
      if (!current) return current;
      const { [slug]: _discarded, ...rest } = current;
      return rest;
    });
    const fallbackSlug = pageSlugs.find((candidate) => candidate !== slug) ?? 'about';
    setSlug(fallbackSlug);
    setNotice('Draft page discarded.');
  };

  const loadDefaults = () => {
    if (!defaults) return;
    const source = defaults[slug] ?? defaults.about ?? Object.values(defaults)[0];
    if (!source) return;
    const nextPage = cloneAboutPage(source);
    nextPage.slug = slug;
    if (!defaults[slug]) {
      nextPage.navLabel = labelFromSlug(slug);
    }
    setDrafts((d) => d ? { ...d, [slug]: nextPage } : d);
    setNotice('Default content loaded. Save to publish.');
  };

  const createPageDraft = () => {
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

    const template = drafts[newPageTemplateSlug] ?? defaults[newPageTemplateSlug] ?? defaults.about ?? Object.values(defaults)[0];
    if (!template) {
      setError('Could not find a template page to clone.');
      return;
    }

    const page = cloneAboutPage(template);
    page.slug = normalizedSlug;
    page.navLabel = labelFromSlug(normalizedSlug);

    setDrafts((current) => current ? { ...current, [normalizedSlug]: page } : current);
    setSlug(normalizedSlug);
    setNewPageSlug('');
    setError(null);
    setNotice(`Created draft page "${normalizedSlug}". Publish to make it live.`);
  };

  if (loading || !drafts || !defaults || !draft) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-stone-400">
        {error
          ? <><AlertCircle className="h-4 w-4 text-red-500" /><span className="text-sm text-red-600">{error}</span></>
          : <><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading editor…</span></>}
      </div>
    );
  }

  const published = formatUpdatedAt(record?.updatedAt ?? null);

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

      case 'linkGrid': return (
        <SectionShell key={section.id} {...shellProps}>
          {header}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
              Cards visible: {section.items.filter((item) => item.hidden !== true).length}/{section.items.length}
            </p>
            <button
              type="button"
              onClick={() =>
                upSec(si, (s) => ({
                  ...(s as AboutLinkGridSection),
                  items: (s as AboutLinkGridSection).items.map((item) => ({ ...item, hidden: false }))
                }))
              }
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <Eye className="h-3.5 w-3.5" /> Show all cards
            </button>
            <button
              type="button"
              onClick={() =>
                upSec(si, (s) => ({
                  ...(s as AboutLinkGridSection),
                  items: (s as AboutLinkGridSection).items.map((item) => ({ ...item, hidden: true }))
                }))
              }
              className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100"
            >
              <EyeOff className="h-3.5 w-3.5" /> Hide all cards
            </button>
          </div>
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
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      upSec(si, (s) => ({
                        ...(s as AboutLinkGridSection),
                        items: (s as AboutLinkGridSection).items.map((x, j) =>
                          j === ii ? { ...x, hidden: x.hidden !== true } : x
                        )
                      }))
                    }
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                      item.hidden
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    {item.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {item.hidden ? 'Show card' : 'Hide card'}
                  </button>
                </div>
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
            Edit content for each public-facing about page. Changes are saved as drafts until you publish.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
                const enabled = drafts ? isAboutPageEnabled(drafts[s]) : true;
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
                        {enabled ? 'Page On' : 'Page Off'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPageEnabled(s, !enabled)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          enabled
                            ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        {enabled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {enabled ? 'Turn Off' : 'Turn On'}
                      </button>
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
                {dirty ? 'Unsaved changes' : 'Up to date'}
              </span>
            </div>
            <p className="text-xs text-stone-400">
              {record?.isCustomized ? '✦ Custom content' : '◦ Using default content'}
              {published ? ` · Published ${published}` : ' · Never published'}
            </p>
            <div className="space-y-2 pt-1">
              <button type="button" onClick={() => void save()} disabled={!dirty || saving}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Publishing…' : 'Publish changes'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={revert} disabled={!dirty || saving}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" /> Revert
                </button>
                <button type="button" onClick={loadDefaults} disabled={saving}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40">
                  <RefreshCw className="h-3.5 w-3.5" /> Defaults
                </button>
              </div>
              {slug === 'about' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAllGetInvolvedCardsVisible(true)}
                    disabled={saving}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                  >
                    <Eye className="h-3.5 w-3.5" /> Show All
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllGetInvolvedCardsVisible(false)}
                    disabled={saving}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                  >
                    <EyeOff className="h-3.5 w-3.5" /> Hide All
                  </button>
                </div>
              )}
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
                <p className="text-sm text-amber-700">You have unsaved changes on this page.</p>
                <button type="button" onClick={() => void save()} disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                  <Save className="h-4 w-4" /> Publish now
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
                  {deferred ? <AboutPageRenderer page={deferred} preview /> : null}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
