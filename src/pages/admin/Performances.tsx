import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { adminFetch } from '../../lib/adminAuth';
import { uploadAdminImage } from '../../lib/adminUploads';
import {
  Plus, Trash2, Upload, X, Edit2, Archive,
  Calendar, Users, MapPin, ChevronRight, ChevronLeft,
  Check, Theater, DollarSign, ImageIcon, Settings
} from 'lucide-react';

// ── types ────────────────────────────────────────────────────────────────────

type CastMember = {
  id?: string;
  name: string;
  role: string;
  photoUrl?: string | null;
  schoolEmail?: string | null;
  gradeLevel?: number | null;
  bio?: string | null;
};
type Performance = {
  id: string; title: string;
  showDescription?: string | null;
  showPosterUrl?: string | null;
  showType?: string | null;
  startsAt: string; salesCutoffAt: string | null;
  staffCompsEnabled: boolean; staffCompLimitPerUser: number; staffTicketLimit: number;
  studentCompTicketsEnabled: boolean;
  seatSelectionEnabled: boolean;
  venue: string; notes?: string | null;
  seatsTotal: number; seatsSold: number; paidOrders: number;
  pricingTiers: Array<{ id: string; name: string; priceCents: number }>;
  castMembers: CastMember[];
};
type FormCastMember = {
  id?: string;
  name: string;
  role: string;
  photoUrl: string;
  schoolEmail?: string;
  gradeLevel?: number | null;
  bio?: string;
};
type FormSchedule   = { startsAt: string; salesCutoffAt: string };
type FormState = {
  title: string; type: string; description: string; posterUrl: string;
  schedules: FormSchedule[];
  venue: string; notes: string; tiersText: string;
  studentCompTicketsEnabled: boolean;
  seatSelectionEnabled: boolean;
  pushCastToStudentComps: boolean;
  castMembers: FormCastMember[];
};

// ── helpers ──────────────────────────────────────────────────────────────────

const emptyCastMember = (): FormCastMember => ({ name: '', role: '', photoUrl: '', schoolEmail: '', gradeLevel: null, bio: '' });
const emptySchedule   = (): FormSchedule   => ({ startsAt: '', salesCutoffAt: '' });

function createInitialForm(): FormState {
  return {
    title: '', type: '', description: '', posterUrl: '',
    schedules: [emptySchedule()],
    venue: 'Penncrest High School Auditorium', notes: '',
    tiersText: 'Adult:1800\nStudent:1200\nChild:1000\nSenior:1400',
    studentCompTicketsEnabled: false,
    seatSelectionEnabled: true,
    pushCastToStudentComps: false,
    castMembers: [emptyCastMember()],
  };
}

function parseTiers(text: string) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [n = '', p = ''] = line.split(':');
    return { name: n.trim(), priceCents: Number(p) };
  }).filter(t => t.name && Number.isFinite(t.priceCents) && t.priceCents > 0);
}

const STEPS = [
  { id: 'basics',  label: 'The Show', icon: Theater    },
  { id: 'dates',   label: 'Dates',    icon: Calendar   },
  { id: 'tickets', label: 'Tickets',  icon: DollarSign },
  { id: 'cast',    label: 'Cast',     icon: Users      },
  { id: 'review',  label: 'Review',   icon: Settings   },
];

const inp = 'w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-300 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition';

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function normalizeImageSource(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return isHttpUrl(trimmed) || isImageDataUrl(trimmed) ? trimmed : '';
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeCsvHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseCastCsv(csvText: string): { castMembers: FormCastMember[]; skippedRows: number; droppedPhotoRows: number } {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { castMembers: [], skippedRows: 0, droppedPhotoRows: 0 };
  }

  const firstRow = parseCsvLine(lines[0]);
  const normalizedHeaders = firstRow.map(normalizeCsvHeader);
  const knownHeaders = new Set(['name', 'studentname', 'role', 'rolename', 'character', 'photourl', 'imageurl', 'photo']);
  const hasHeaderRow = normalizedHeaders.some((header) => knownHeaders.has(header));

  const nameIndex = hasHeaderRow
    ? (() => {
        const idx = normalizedHeaders.indexOf('name');
        if (idx >= 0) return idx;
        return normalizedHeaders.indexOf('studentname');
      })()
    : 0;

  const roleIndex = hasHeaderRow
    ? (() => {
        const idx = normalizedHeaders.indexOf('role');
        if (idx >= 0) return idx;
        const roleNameIndex = normalizedHeaders.indexOf('rolename');
        if (roleNameIndex >= 0) return roleNameIndex;
        return normalizedHeaders.indexOf('character');
      })()
    : 1;

  const photoIndex = hasHeaderRow
    ? (() => {
        const photoUrlIdx = normalizedHeaders.indexOf('photourl');
        if (photoUrlIdx >= 0) return photoUrlIdx;
        const imageUrlIdx = normalizedHeaders.indexOf('imageurl');
        if (imageUrlIdx >= 0) return imageUrlIdx;
        return normalizedHeaders.indexOf('photo');
      })()
    : 2;

  if (nameIndex < 0 || roleIndex < 0) {
    throw new Error('CSV must include name and role columns.');
  }

  const start = hasHeaderRow ? 1 : 0;
  const castMembers: FormCastMember[] = [];
  let skippedRows = 0;
  let droppedPhotoRows = 0;

  for (let i = start; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const name = (cols[nameIndex] || '').trim();
    const role = (cols[roleIndex] || '').trim();
    const photoRaw = photoIndex >= 0 ? (cols[photoIndex] || '').trim() : '';
    const photoUrl = normalizeImageSource(photoRaw);

    if (!name || !role) {
      skippedRows += 1;
      continue;
    }

    if (photoRaw && !photoUrl) {
      droppedPhotoRows += 1;
    }

    castMembers.push({ name, role, photoUrl });
  }

  return { castMembers, skippedRows, droppedPhotoRows };
}

// ── main ─────────────────────────────────────────────────────────────────────

export default function AdminPerformancesPage() {
  const [items,             setItems]             = useState<Performance[]>([]);
  const [form,              setForm]              = useState<FormState>(createInitialForm);
  const [editingId,         setEditingId]         = useState<string | null>(null);
  const [error,             setError]             = useState<string | null>(null);
  const [uploadingCastIdx,  setUploadingCastIdx]  = useState<number | null>(null);
  const [isPosterUploading, setIsPosterUploading] = useState(false);
  const [castImportFileName, setCastImportFileName] = useState('');
  const [castImportSummary, setCastImportSummary] = useState<string | null>(null);
  const [step,              setStep]              = useState(0);
  const [dir,               setDir]               = useState<1 | -1>(1);
  const [showWizard,        setShowWizard]        = useState(false);

  const tiers = useMemo(() => parseTiers(form.tiersText), [form.tiersText]);

  const load = () =>
    adminFetch<Performance[]>('/api/admin/performances')
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Load failed'));

  useEffect(() => { load(); }, []);

  const goTo = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); setError(null); };

  const submit = async () => {
    setError(null);
    if (tiers.length === 0) { setError('Add at least one pricing tier (Name:Price).'); return; }
    const schedules = form.schedules.map(s => ({ startsAt: s.startsAt.trim(), salesCutoffAt: s.salesCutoffAt.trim() }));
    if (schedules.some(s => !s.startsAt && s.salesCutoffAt)) { setError('Sales cutoff requires a date.'); return; }
    const perfs = schedules.filter(s => s.startsAt);
    if (!perfs.length) { setError('Add at least one performance date.'); return; }
    const cast = form.castMembers.reduce<
      Array<{
        id?: string;
        name: string;
        role: string;
        photoUrl?: string;
        schoolEmail?: string;
        gradeLevel?: number;
        bio?: string;
      }>
    >((acc, member) => {
      const name = member.name.trim();
      const role = member.role.trim();
      if (!name || !role) return acc;

      const photoUrl = normalizeImageSource(member.photoUrl);
      const schoolEmail = member.schoolEmail?.trim().toLowerCase() || '';
      const gradeLevel = member.gradeLevel ?? undefined;
      const bio = member.bio?.trim() || '';
      acc.push({
        ...(member.id ? { id: member.id } : {}),
        name,
        role,
        ...(photoUrl ? { photoUrl } : {}),
        ...(schoolEmail ? { schoolEmail } : {}),
        ...(gradeLevel !== undefined ? { gradeLevel } : {}),
        ...(bio ? { bio } : {})
      });
      return acc;
    }, []);
    const payload = {
      title: form.title.trim(),
      type: form.type.trim() || undefined,
      description: form.description.trim() || undefined,
      posterUrl: form.posterUrl.trim() || undefined,
      staffCompsEnabled: true,
      staffCompLimitPerUser: 1,
      studentCompTicketsEnabled: form.studentCompTicketsEnabled,
      seatSelectionEnabled: form.seatSelectionEnabled,
      pushCastToStudentComps: form.pushCastToStudentComps,
      venue: form.venue, notes: form.notes, pricingTiers: tiers, castMembers: cast,
    };
    try {
      if (editingId) {
        const f = perfs[0];
        await adminFetch(`/api/admin/performances/${editingId}`, { method: 'PATCH', body: JSON.stringify({ ...payload, startsAt: new Date(f.startsAt).toISOString(), salesCutoffAt: f.salesCutoffAt ? new Date(f.salesCutoffAt).toISOString() : null }) });
      } else {
        await adminFetch('/api/admin/performances', { method: 'POST', body: JSON.stringify({ ...payload, performances: perfs.map(s => ({ startsAt: new Date(s.startsAt).toISOString(), salesCutoffAt: s.salesCutoffAt ? new Date(s.salesCutoffAt).toISOString() : null })) }) });
      }
      closeWizard(); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };

  const closeWizard = () => {
    setShowWizard(false);
    setEditingId(null);
    setForm(createInitialForm());
    setCastImportFileName('');
    setCastImportSummary(null);
    setStep(0);
    setError(null);
  };

  const startEditing = (item: Performance) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      type: item.showType || '',
      description: item.showDescription || '',
      posterUrl: item.showPosterUrl || '',
      schedules: [{ startsAt: item.startsAt.slice(0, 16), salesCutoffAt: item.salesCutoffAt ? item.salesCutoffAt.slice(0, 16) : '' }],
      venue: item.venue, notes: item.notes || '',
      tiersText: item.pricingTiers.map(t => `${t.name}:${t.priceCents}`).join('\n'),
      studentCompTicketsEnabled: Boolean(item.studentCompTicketsEnabled),
      seatSelectionEnabled: item.seatSelectionEnabled !== false,
      pushCastToStudentComps: false,
      castMembers: item.castMembers.length > 0
        ? item.castMembers.map((m) => ({
            id: m.id,
            name: m.name,
            role: m.role,
            photoUrl: m.photoUrl || '',
            schoolEmail: m.schoolEmail || '',
            gradeLevel: m.gradeLevel ?? null,
            bio: m.bio || ''
          }))
        : [emptyCastMember()],
    });
    setCastImportFileName('');
    setCastImportSummary(null);
    setStep(0); setShowWizard(true);
  };

  const archivePerformance = async (item: Performance) => {
    if (!confirm(`Archive "${item.title}"? Hidden from sales but data is kept.`)) return;
    try {
      await adminFetch(`/api/admin/performances/${item.id}/archive`, { method: 'POST' });
      if (editingId === item.id) closeWizard();
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Archive failed'); }
  };

  const setCast    = (i: number, next: Partial<FormCastMember>) => setForm(p => ({ ...p, castMembers: p.castMembers.map((m, j) => j === i ? { ...m, ...next } : m) }));
  const addCast    = () => setForm(p => ({ ...p, castMembers: [...p.castMembers, emptyCastMember()] }));
  const removeCast = (i: number) => setForm(p => ({ ...p, castMembers: p.castMembers.length <= 1 ? [emptyCastMember()] : p.castMembers.filter((_, j) => j !== i) }));
  const setSched   = (i: number, next: Partial<FormSchedule>) => setForm(p => ({ ...p, schedules: p.schedules.map((s, j) => j === i ? { ...s, ...next } : s) }));
  const addSched   = () => setForm(p => ({ ...p, schedules: [...p.schedules, emptySchedule()] }));
  const removeSched = (i: number) => setForm(p => ({ ...p, schedules: p.schedules.length <= 1 ? [emptySchedule()] : p.schedules.filter((_, j) => j !== i) }));

  const handlePosterUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) { return; }
    setError(null); setIsPosterUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 1200,
        maxHeight: 1800,
        scope: 'show-posters',
        filenameBase: form.title || 'show-poster'
      });
      setForm(p => ({ ...p, posterUrl: uploaded.url }));
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setIsPosterUploading(false); }
  };

  const handleCastUpload = async (i: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) { return; }
    setError(null); setUploadingCastIdx(i);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 640,
        maxHeight: 860,
        scope: 'cast-photos',
        filenameBase: form.castMembers[i]?.name || 'cast-member'
      });
      setCast(i, { photoUrl: uploaded.url });
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploadingCastIdx(null); }
  };

  const handleCastCsvImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setCastImportSummary(null);
    setCastImportFileName(file.name);

    try {
      const text = await file.text();
      const { castMembers, skippedRows, droppedPhotoRows } = parseCastCsv(text);
      if (castMembers.length === 0) {
        throw new Error('No valid cast rows found. Include name and role columns.');
      }

      setForm((prev) => ({ ...prev, castMembers }));
      const notes: string[] = [];
      if (skippedRows > 0) {
        notes.push(`${skippedRows} row${skippedRows === 1 ? '' : 's'} skipped`);
      }
      if (droppedPhotoRows > 0) {
        notes.push(`${droppedPhotoRows} invalid photo URL${droppedPhotoRows === 1 ? '' : 's'} ignored`);
      }
      setCastImportSummary(
        `Imported ${castMembers.length} cast member${castMembers.length === 1 ? '' : 's'}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import cast CSV');
    }
  };

  // ── step panels ─────────────────────────────────────────────────────────────
  const stepContent = [

    // 0 — THE SHOW
    <div key="basics" className="space-y-5">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Show Title</label>
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Into the Woods" className={inp}
          style={{ fontSize: '1.05rem', fontFamily: 'var(--font-sans)' }} />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Tag</label>
        <input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
          placeholder="e.g. Musical" className={inp} />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Description</label>
        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          rows={4} placeholder="A short description shown on the public show page and season card."
          className={inp + ' resize-none'} />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Venue</label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-300 pointer-events-none" />
          <input value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} placeholder="Venue name" className={inp + ' pl-10'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Notes <span className="normal-case font-normal text-stone-300">(internal only)</span></label>
        <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any notes for the team…" className={inp} />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Poster</label>
        <div className="flex gap-3 items-start">
          {form.posterUrl
            ? <img src={form.posterUrl} className="w-14 h-20 rounded-xl object-cover border border-stone-100 shadow-sm flex-shrink-0" />
            : <div className="w-14 h-20 rounded-xl bg-stone-100 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-5 h-5 text-stone-300" /></div>
          }
          <div className="flex-1 space-y-2">
            <input value={form.posterUrl} onChange={e => setForm({ ...form, posterUrl: e.target.value })} placeholder="Paste image URL…" className={inp} />
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-white transition w-fit">
              <Upload className="w-3.5 h-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={e => { void handlePosterUpload(e); }} />
              {isPosterUploading ? 'Uploading…' : 'Upload file'}
            </label>
            {form.posterUrl && <button type="button" onClick={() => setForm({ ...form, posterUrl: '' })} className="block text-xs text-red-400 hover:text-red-600 transition">Remove</button>}
          </div>
        </div>
      </div>
    </div>,

    // 1 — DATES
    <div key="dates" className="space-y-4">
      <p className="text-sm text-stone-400 leading-relaxed">Add one row for each night of the show.</p>
      <div className="space-y-3">
        {form.schedules.map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-stone-400">Show {i + 1}</span>
              {form.schedules.length > 1 && (
                <button type="button" onClick={() => removeSched(i)} className="text-stone-300 hover:text-red-500 transition"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Date & time</label>
                <input type="datetime-local" value={s.startsAt} onChange={e => setSched(i, { startsAt: e.target.value })} className={inp} />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Sales cutoff <span className="text-stone-300">(optional)</span></label>
                <input type="datetime-local" value={s.salesCutoffAt} onChange={e => setSched(i, { salesCutoffAt: e.target.value })} className={inp} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      {!editingId
        ? <button type="button" onClick={addSched} className="flex items-center gap-2 text-sm font-semibold text-red-700 hover:text-red-800 transition">
            <Plus className="w-4 h-4" /> Add another date
          </button>
        : <p className="text-xs text-stone-300 italic">Editing updates this one performance only.</p>
      }
    </div>,

    // 2 — TICKETS
    <div key="tickets" className="space-y-5">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Pricing Tiers</label>
        <p className="text-xs text-stone-300 mb-2">One per line — <code className="bg-stone-100 px-1 rounded text-stone-500">Name:PriceCents</code></p>
        <textarea value={form.tiersText} onChange={e => setForm({ ...form, tiersText: e.target.value })}
          rows={4} placeholder={'Adult:1800\nStudent:1200'} className={inp + ' font-sans text-xs resize-none'} />
        {tiers.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {tiers.map(t => (
              <span key={t.name} className="rounded-full bg-red-50 border border-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                {t.name} · ${(t.priceCents / 100).toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="text-sm text-stone-500">
        Verified staff comps are enabled automatically.
      </p>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-800">Student comp tickets</p>
            <p className="text-xs text-stone-500">
              Controls whether Student-in-Show complimentary checkout is available for this performance.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.studentCompTicketsEnabled}
            onClick={() => setForm((prev) => ({ ...prev, studentCompTicketsEnabled: !prev.studentCompTicketsEnabled }))}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              form.studentCompTicketsEnabled
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                : 'bg-stone-100 text-stone-500 border border-stone-200'
            }`}
          >
            {form.studentCompTicketsEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-800">Seat selection on checkout</p>
            <p className="text-xs text-stone-500">
              Turn this off to let buyers pick ticket quantity only while seats are auto-assigned behind the scenes.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.seatSelectionEnabled}
            onClick={() => setForm((prev) => ({ ...prev, seatSelectionEnabled: !prev.seatSelectionEnabled }))}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              form.seatSelectionEnabled
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                : 'bg-stone-100 text-stone-500 border border-stone-200'
            }`}
          >
            {form.seatSelectionEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>,

    // 3 — CAST
    <div key="cast" className="space-y-4">
      <p className="text-sm text-stone-400">Optional — shown on the public show detail page.</p>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs text-stone-500">
          Import CSV columns: <span className="font-sans text-stone-700">name, role, photoUrl</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input id="cast-csv-file" type="file" accept=".csv,text/csv" className="hidden" onChange={e => { void handleCastCsvImport(e); }} />
          <label
            htmlFor="cast-csv-file"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {castImportFileName ? 'Replace CSV' : 'Import CSV'}
          </label>
          <span className="text-xs text-stone-500">{castImportFileName || 'No file selected'}</span>
        </div>
        {castImportSummary && (
          <p className="mt-2 text-xs font-semibold text-emerald-700">{castImportSummary}</p>
        )}
      </div>
      <div className="space-y-3">
        {form.castMembers.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-xl border border-stone-100 bg-stone-50 p-3">
            <div className="flex-shrink-0">
              {m.photoUrl
                ? <img src={m.photoUrl} className="w-11 h-11 rounded-xl object-cover border border-stone-200" />
                : <div className="w-11 h-11 rounded-xl bg-stone-200 flex items-center justify-center border border-stone-200">
                    <img src="/favicon.svg" alt="" className="h-7 w-7 object-contain opacity-60" />
                  </div>}
            </div>
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input value={m.name} onChange={e => setCast(i, { name: e.target.value })} placeholder="Name" className={inp + ' text-sm py-2'} />
                <input value={m.role} onChange={e => setCast(i, { role: e.target.value })} placeholder="Role" className={inp + ' text-sm py-2'} />
              </div>
              <div className="flex gap-2 items-center">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 transition">
                  <Upload className="w-3 h-3" />
                  <input type="file" accept="image/*" className="hidden" onChange={e => { void handleCastUpload(i, e); }} />
                  {uploadingCastIdx === i ? 'Uploading…' : m.photoUrl ? 'Change photo' : 'Add photo'}
                </label>
                {m.photoUrl && <button type="button" onClick={() => setCast(i, { photoUrl: '' })} className="text-xs text-stone-400 hover:text-red-500 transition">Remove</button>}
              </div>
            </div>
            <button type="button" onClick={() => removeCast(i)} className="text-stone-200 hover:text-red-500 transition flex-shrink-0 pt-1"><X className="w-4 h-4" /></button>
          </motion.div>
        ))}
      </div>
      <button type="button" onClick={addCast} className="flex items-center gap-2 text-sm font-semibold text-red-700 hover:text-red-800 transition">
        <Plus className="w-4 h-4" /> Add cast member
      </button>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-800">Sync Cast to Student Comp Codes</p>
            <p className="text-xs text-stone-500">
              When you save, cast names are pushed into Student Credits using first initial + last name codes.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.pushCastToStudentComps}
            onClick={() => setForm((prev) => ({ ...prev, pushCastToStudentComps: !prev.pushCastToStudentComps }))}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              form.pushCastToStudentComps
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                : 'bg-stone-100 text-stone-500 border border-stone-200'
            }`}
          >
            {form.pushCastToStudentComps ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>,

    // 4 — REVIEW
    <div key="review" className="space-y-4">
      <p className="text-sm text-stone-400">Everything look good?</p>
      <div className="rounded-2xl border border-stone-100 divide-y divide-stone-100 overflow-hidden bg-white">
        {[
          { label: 'Title',        value: form.title || <span className="text-red-400 font-semibold">Missing!</span> },
          { label: 'Tag',          value: form.type || <span className="text-stone-300">None</span> },
          { label: 'Description',  value: form.description || <span className="text-stone-300">None</span> },
          { label: 'Venue',        value: form.venue },
          { label: 'Dates',        value: `${form.schedules.filter(s => s.startsAt).length} date(s)` },
          { label: 'Pricing',      value: tiers.length > 0 ? tiers.map(t => `${t.name} $${(t.priceCents/100).toFixed(2)}`).join(' · ') : <span className="text-red-400 font-semibold">Missing!</span> },
          { label: 'Student comps', value: form.studentCompTicketsEnabled ? '✓ Enabled' : 'Disabled' },
          { label: 'Seat selection', value: form.seatSelectionEnabled ? 'Enabled' : 'Auto-assign mode' },
          { label: 'Cast',         value: `${form.castMembers.filter(m => m.name && m.role).length} member(s)` },
          { label: 'Cast comp sync', value: form.pushCastToStudentComps ? 'On' : 'Off' },
          { label: 'Staff comps',  value: '✓ Enabled' },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-stone-400">{label}</span>
            <span className="max-w-full text-stone-800 font-semibold sm:max-w-[55%] sm:text-right">{value}</span>
          </div>
        ))}
      </div>
      {form.posterUrl && (
        <div className="flex items-center gap-3">
          <img src={form.posterUrl} className="w-10 h-14 rounded-lg object-cover border border-stone-100 shadow-sm" />
          <span className="text-sm text-stone-400">Poster attached</span>
          <Check className="w-4 h-4 text-green-500" />
        </div>
      )}
    </div>,
  ];

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-6" style={{ fontFamily: 'var(--font-sans)' }}>

      {/* page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'var(--font-sans)' }}>Performances</h1>
          <p className="text-sm text-stone-400 mt-0.5">Archived shows live in the Archive tab.</p>
        </div>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => {
            setEditingId(null);
            setForm(createInitialForm());
            setCastImportFileName('');
            setCastImportSummary(null);
            setError(null);
            setShowWizard(true);
            setStep(0);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition shadow-sm shadow-red-100 hover:bg-red-800 sm:w-auto">
          <Plus className="w-4 h-4" /> New Performance
        </motion.button>
      </div>

      {/* ── wizard modal ── */}
      <AnimatePresence>
        {showWizard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4">
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 16 }}
              animate={{ scale: 1,    opacity: 1, y: 0  }}
              exit={{    scale: 0.93, opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
            >
              {/* header */}
              <div className="border-b border-stone-100 px-4 pb-4 pt-5 sm:px-6 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-bold text-stone-900" style={{ fontFamily: 'var(--font-sans)' }}>
                    {editingId ? 'Edit Performance' : 'New Performance'}
                  </p>
                  <button onClick={closeWizard} className="text-stone-300 hover:text-stone-600 transition rounded-full p-1 hover:bg-stone-50"><X className="w-5 h-5" /></button>
                </div>
                {/* step pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {STEPS.map((s, i) => {
                    const Icon = s.icon;
                    const done = i < step, active = i === step;
                    return (
                      <button key={s.id} type="button" onClick={() => goTo(i)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                          active ? 'bg-red-700 text-white shadow-sm' :
                          done   ? 'bg-green-50 text-green-700 border border-green-200' :
                                   'bg-stone-100 text-stone-400 hover:bg-stone-200'
                        }`}>
                        {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                        <span className="hidden sm:inline">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* body */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={step}
                    initial={{ x: dir * 32, opacity: 0 }}
                    animate={{ x: 0,        opacity: 1 }}
                    exit={{    x: dir * -32, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {stepContent[step]}
                  </motion.div>
                </AnimatePresence>

                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* footer */}
              <div className="border-t border-stone-100 bg-stone-50/60 px-4 py-4 sm:px-6 flex-shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0}
                  className="flex items-center gap-1 text-sm font-semibold text-stone-400 hover:text-stone-800 disabled:opacity-25 disabled:cursor-not-allowed transition">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <span className="text-xs text-stone-300">{step + 1} / {STEPS.length}</span>
                {step < STEPS.length - 1
                  ? <button type="button" onClick={() => goTo(step + 1)}
                      className="flex items-center gap-1.5 bg-stone-900 text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-stone-800 transition">
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  : <motion.button type="button" onClick={submit}
                      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-1.5 bg-red-700 text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-800 transition shadow-sm shadow-red-100">
                      <Check className="w-4 h-4" /> {editingId ? 'Save Changes' : 'Create'}
                    </motion.button>
                }
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── list ── */}
      <div className="space-y-3">
        {items.length === 0
          ? <div className="rounded-2xl border border-dashed border-stone-200 py-14 text-center text-sm text-stone-300">No active performances yet.</div>
          : items.map((item, idx) => {
              const pct = item.seatsTotal > 0 ? Math.round((item.seatsSold / item.seatsTotal) * 100) : 0;
              return (
                <motion.div key={item.id}
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  className="flex flex-col gap-4 rounded-2xl border border-stone-100 bg-white p-4 transition-all hover:border-stone-200 hover:shadow-md sm:flex-row"
                >
                  {item.showPosterUrl
                    ? <img src={item.showPosterUrl} className="w-12 h-16 rounded-xl object-cover border border-stone-100 flex-shrink-0" />
                    : <div className="w-12 h-16 rounded-xl bg-stone-100 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-4 h-4 text-stone-300" /></div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="font-bold text-stone-900" style={{ fontFamily: 'var(--font-sans)' }}>{item.title}</p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => startEditing(item)} className="flex items-center gap-1 text-xs font-semibold text-stone-500 hover:text-stone-900 border border-stone-200 rounded-lg px-2.5 py-1 hover:bg-stone-50 transition">
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                        <button onClick={() => { void archivePerformance(item); }} className="flex items-center gap-1 text-xs font-semibold text-amber-600 border border-amber-200 rounded-lg px-2.5 py-1 hover:bg-amber-50 transition">
                          <Archive className="w-3 h-3" /> Archive
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-stone-400 mt-0.5 flex items-center gap-1 flex-wrap">
                      <Calendar className="w-3 h-3" />{new Date(item.startsAt).toLocaleString()}
                      <span className="text-stone-200">·</span>
                      <MapPin className="w-3 h-3" />{item.venue}
                    </p>
                    <div className="mt-2.5">
                      <div className="flex justify-between text-xs text-stone-400 mb-1">
                        <span>{item.seatsSold} / {item.seatsTotal} seats</span>
                        <span className={pct >= 90 ? 'text-red-500 font-bold' : pct >= 60 ? 'text-amber-500 font-semibold' : ''}>{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: idx * 0.06 + 0.2 }}
                          className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{item.paidOrders} orders</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{item.castMembers.length} cast</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                        {item.seatSelectionEnabled ? 'Seat map checkout' : 'Auto-assign checkout'}
                      </span>
                      {item.pricingTiers.map(t => (
                        <span key={t.id} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{t.name} ${(t.priceCents/100).toFixed(2)}</span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
      </div>
    </div>
  );
}
