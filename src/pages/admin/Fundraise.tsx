import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Calendar,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Edit2,
  Globe,
  ImageIcon,
  Landmark,
  MapPin,
  Plus,
  Save,
  Settings,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';
import { uploadAdminImage } from '../../lib/adminUploads';

type AdminFundraiseTab = 'events' | 'sponsors';

type FundraiseEvent = {
  id: string;
  title: string;
  showDescription?: string | null;
  showPosterUrl?: string | null;
  startsAt: string;
  salesCutoffAt: string | null;
  seatSelectionEnabled: boolean;
  venue: string;
  notes?: string | null;
  seatsTotal: number;
  seatsSold: number;
  pricingTiers: Array<{ id: string; name: string; priceCents: number }>;
};

type EventForm = {
  title: string;
  description: string;
  posterUrl: string;
  startsAt: string;
  salesCutoffAt: string;
  venue: string;
  notes: string;
  tiersText: string;
  seatSelectionEnabled: boolean;
};

type FundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Gold' | 'Silver' | 'Bronze';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

type SponsorForm = {
  name: string;
  tier: 'Gold' | 'Silver' | 'Bronze';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

const inputClass =
  'w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-300 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition';
const labelClass = 'block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2';

const STEPS = [
  { id: 'event', label: 'The Event', icon: Calendar },
  { id: 'schedule', label: 'Date', icon: CalendarClock },
  { id: 'tickets', label: 'Tickets', icon: DollarSign },
  { id: 'review', label: 'Review', icon: Settings }
];

const SPONSOR_STEPS = [
  { id: 'brand', label: 'Brand', icon: Landmark },
  { id: 'media', label: 'Media', icon: ImageIcon },
  { id: 'review', label: 'Review', icon: Settings }
] as const;

function createInitialForm(): EventForm {
  return {
    title: '',
    description: '',
    posterUrl: '',
    startsAt: '',
    salesCutoffAt: '',
    venue: 'Penncrest High School Auditorium',
    notes: '',
    tiersText: 'Adult:1800\nStudent:1200',
    seatSelectionEnabled: true
  };
}

function createInitialSponsorForm(): SponsorForm {
  return {
    name: '',
    tier: 'Gold',
    logoUrl: '',
    imageUrl: '',
    spotlight: '',
    websiteUrl: 'https://'
  };
}

function parseTiers(text: string): Array<{ name: string; priceCents: number }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', cents = ''] = line.split(':');
      return { name: name.trim(), priceCents: Number(cents) };
    })
    .filter((tier) => tier.name && Number.isFinite(tier.priceCents) && tier.priceCents > 0);
}

export default function AdminFundraisePage() {
  const [tab, setTab] = useState<AdminFundraiseTab>('events');
  const [events, setEvents] = useState<FundraiseEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [form, setForm] = useState<EventForm>(createInitialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [isPosterUploading, setIsPosterUploading] = useState(false);
  const [sponsors, setSponsors] = useState<FundraisingSponsor[]>([]);
  const [sponsorsLoading, setSponsorsLoading] = useState(true);
  const [sponsorForm, setSponsorForm] = useState<SponsorForm>(createInitialSponsorForm);
  const [sponsorEditingId, setSponsorEditingId] = useState<string | null>(null);
  const [showSponsorWizard, setShowSponsorWizard] = useState(false);
  const [sponsorStep, setSponsorStep] = useState(0);
  const [sponsorDir, setSponsorDir] = useState<1 | -1>(1);
  const [sponsorSaving, setSponsorSaving] = useState(false);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [isSponsorLogoUploading, setIsSponsorLogoUploading] = useState(false);
  const [isSponsorImageUploading, setIsSponsorImageUploading] = useState(false);
  const [deletingSponsorId, setDeletingSponsorId] = useState<string | null>(null);

  const tiers = useMemo(() => parseTiers(form.tiersText), [form.tiersText]);
  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const items = await adminFetch<FundraiseEvent[]>('/api/admin/performances?scope=active&kind=fundraise');
      setEvents(items);
      if (items.length > 0 && !items.some((item) => item.id === selectedEventId)) {
        setSelectedEventId(items[0].id);
      }
      if (items.length === 0) {
        setSelectedEventId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fundraising events');
    } finally {
      setLoading(false);
    }
  }

  async function loadSponsors() {
    setSponsorsLoading(true);
    setSponsorError(null);
    try {
      const data = await adminFetch<{ sponsors: FundraisingSponsor[] }>('/api/admin/fundraising/sponsors');
      setSponsors(Array.isArray(data.sponsors) ? data.sponsors : []);
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'Failed to load sponsors');
    } finally {
      setSponsorsLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
    void loadSponsors();
  }, []);

  const goTo = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
    setError(null);
  };

  function closeWizard() {
    setShowWizard(false);
    setEditingId(null);
    setForm(createInitialForm());
    setStep(0);
    setError(null);
    setIsPosterUploading(false);
  }

  function startNewEvent() {
    setEditingId(null);
    setSelectedEventId('');
    setForm(createInitialForm());
    setShowWizard(true);
    setStep(0);
    setError(null);
    setNotice('Creating a new fundraising event.');
  }

  function startEditEvent(event: FundraiseEvent) {
    setEditingId(event.id);
    setSelectedEventId(event.id);
    setForm({
      title: event.title,
      description: event.showDescription || '',
      posterUrl: event.showPosterUrl || '',
      startsAt: event.startsAt.slice(0, 16),
      salesCutoffAt: event.salesCutoffAt ? event.salesCutoffAt.slice(0, 16) : '',
      venue: event.venue,
      notes: event.notes || '',
      tiersText: event.pricingTiers.map((tier) => `${tier.name}:${tier.priceCents}`).join('\n'),
      seatSelectionEnabled: event.seatSelectionEnabled !== false
    });
    setNotice(`Editing "${event.title}".`);
    setError(null);
    setStep(0);
    setShowWizard(true);
  }

  const handlePosterUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setIsPosterUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 1400,
        maxHeight: 1900,
        scope: 'fundraise-posters',
        filenameBase: form.title || 'fundraising-event'
      });
      setForm((prev) => ({ ...prev, posterUrl: uploaded.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsPosterUploading(false);
    }
  };

  async function saveEvent() {
    if (!form.title.trim()) {
      setError('Event title is required.');
      return;
    }
    if (!form.startsAt.trim()) {
      setError('Event date/time is required.');
      return;
    }
    if (tiers.length === 0) {
      setError('Add at least one pricing tier in Name:PriceCents format.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      posterUrl: form.posterUrl.trim() || undefined,
      type: 'Fundraiser',
      isFundraiser: true,
      staffCompsEnabled: true,
      staffCompLimitPerUser: 1,
      staffTicketLimit: 2,
      studentCompTicketsEnabled: false,
      seatSelectionEnabled: form.seatSelectionEnabled,
      venue: form.venue.trim() || 'Penncrest High School Auditorium',
      notes: form.notes.trim() || undefined,
      pricingTiers: tiers
    };

    try {
      if (editingId) {
        await adminFetch(`/api/admin/performances/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...payload,
            startsAt: new Date(form.startsAt).toISOString(),
            salesCutoffAt: form.salesCutoffAt ? new Date(form.salesCutoffAt).toISOString() : null
          })
        });
        setNotice('Fundraising event updated.');
      } else {
        const created = await adminFetch<{ id: string }>('/api/admin/performances', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            performances: [
              {
                title: form.title.trim(),
                startsAt: new Date(form.startsAt).toISOString(),
                salesCutoffAt: form.salesCutoffAt ? new Date(form.salesCutoffAt).toISOString() : null
              }
            ]
          })
        });
        setEditingId(created.id);
        setSelectedEventId(created.id);
        setNotice('Fundraising event created.');
      }

      await loadEvents();
      closeWizard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fundraising event');
    } finally {
      setSaving(false);
    }
  }

  async function archiveEvent(event: FundraiseEvent) {
    if (!window.confirm(`Archive "${event.title}"?`)) return;

    setError(null);
    try {
      await adminFetch(`/api/admin/performances/${event.id}/archive`, { method: 'POST' });
      setNotice(`Archived "${event.title}".`);
      setEditingId(null);
      setSelectedEventId('');
      setForm(createInitialForm());
      setShowWizard(false);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive fundraising event');
    }
  }

  const goToSponsorStep = (next: number) => {
    setSponsorDir(next > sponsorStep ? 1 : -1);
    setSponsorStep(next);
    setSponsorError(null);
  };

  function closeSponsorWizard() {
    setShowSponsorWizard(false);
    setSponsorEditingId(null);
    setSponsorForm(createInitialSponsorForm());
    setSponsorStep(0);
    setSponsorError(null);
    setIsSponsorLogoUploading(false);
    setIsSponsorImageUploading(false);
  }

  function startNewSponsor() {
    setSponsorEditingId(null);
    setSponsorForm(createInitialSponsorForm());
    setShowSponsorWizard(true);
    setSponsorStep(0);
    setSponsorError(null);
    setNotice('Creating a new sponsor.');
  }

  function startEditSponsor(sponsor: FundraisingSponsor) {
    setSponsorEditingId(sponsor.id);
    setSponsorForm({
      name: sponsor.name,
      tier: sponsor.tier,
      logoUrl: sponsor.logoUrl,
      imageUrl: sponsor.imageUrl,
      spotlight: sponsor.spotlight,
      websiteUrl: sponsor.websiteUrl
    });
    setShowSponsorWizard(true);
    setSponsorStep(0);
    setSponsorError(null);
    setNotice(`Editing sponsor "${sponsor.name}".`);
  }

  const handleSponsorLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSponsorError(null);
    setIsSponsorLogoUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 800,
        maxHeight: 320,
        scope: 'fundraise-sponsor-logos',
        filenameBase: sponsorForm.name || 'fundraising-sponsor-logo'
      });
      setSponsorForm((prev) => ({ ...prev, logoUrl: uploaded.url }));
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'Failed to upload sponsor logo');
    } finally {
      setIsSponsorLogoUploading(false);
    }
  };

  const handleSponsorImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSponsorError(null);
    setIsSponsorImageUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 1600,
        maxHeight: 1000,
        scope: 'fundraise-sponsor-images',
        filenameBase: sponsorForm.name || 'fundraising-sponsor-image'
      });
      setSponsorForm((prev) => ({ ...prev, imageUrl: uploaded.url }));
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'Failed to upload sponsor image');
    } finally {
      setIsSponsorImageUploading(false);
    }
  };

  async function saveSponsor() {
    if (!sponsorForm.name.trim()) {
      setSponsorError('Sponsor name is required.');
      return;
    }
    if (!sponsorForm.websiteUrl.trim()) {
      setSponsorError('Sponsor website is required.');
      return;
    }
    if (!sponsorForm.logoUrl) {
      setSponsorError('Upload a sponsor logo.');
      return;
    }
    if (!sponsorForm.imageUrl) {
      setSponsorError('Upload a sponsor spotlight image.');
      return;
    }
    if (!sponsorForm.spotlight.trim()) {
      setSponsorError('Sponsor spotlight text is required.');
      return;
    }

    setSponsorSaving(true);
    setSponsorError(null);
    setNotice(null);
    const payload = {
      name: sponsorForm.name.trim(),
      tier: sponsorForm.tier,
      logoUrl: sponsorForm.logoUrl,
      imageUrl: sponsorForm.imageUrl,
      spotlight: sponsorForm.spotlight.trim(),
      websiteUrl: sponsorForm.websiteUrl.trim()
    };

    try {
      if (sponsorEditingId) {
        await adminFetch(`/api/admin/fundraising/sponsors/${sponsorEditingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setNotice('Sponsor updated.');
      } else {
        await adminFetch('/api/admin/fundraising/sponsors', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setNotice('Sponsor created.');
      }
      await loadSponsors();
      closeSponsorWizard();
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'Failed to save sponsor');
    } finally {
      setSponsorSaving(false);
    }
  }

  async function deleteSponsor(sponsor: FundraisingSponsor) {
    if (!window.confirm(`Delete sponsor "${sponsor.name}"?`)) return;
    setDeletingSponsorId(sponsor.id);
    setSponsorError(null);
    try {
      await adminFetch(`/api/admin/fundraising/sponsors/${sponsor.id}`, { method: 'DELETE' });
      setNotice(`Deleted sponsor "${sponsor.name}".`);
      if (sponsorEditingId === sponsor.id) {
        closeSponsorWizard();
      }
      await loadSponsors();
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'Failed to delete sponsor');
    } finally {
      setDeletingSponsorId(null);
    }
  }

  const stepContent: ReactNode[] = [
    <div key="event" className="space-y-5">
      <div>
        <label className={labelClass}>Event Title</label>
        <input
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="e.g. Spring Cabaret Night"
          className={inputClass}
          style={{ fontSize: '1.05rem', fontFamily: 'var(--font-sans)' }}
        />
      </div>
      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          rows={4}
          className={`${inputClass} resize-none`}
          placeholder="Short public summary for the fundraising page."
        />
      </div>
      <div>
        <label className={labelClass}>Venue</label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-300" />
          <input
            value={form.venue}
            onChange={(event) => setForm((prev) => ({ ...prev, venue: event.target.value }))}
            className={`${inputClass} pl-10`}
            placeholder="Venue name"
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>
          Notes <span className="normal-case font-normal text-stone-300">(internal only)</span>
        </label>
        <input
          value={form.notes}
          onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          className={inputClass}
          placeholder="Anything your team should remember for this fundraiser"
        />
      </div>
      <div>
        <label className={labelClass}>Poster</label>
        <div className="flex items-start gap-3">
          {form.posterUrl ? (
            <img
              src={form.posterUrl}
              alt="Fundraiser poster"
              className="h-20 w-14 flex-shrink-0 rounded-xl border border-stone-100 object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-20 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-stone-100">
              <ImageIcon className="h-5 w-5 text-stone-300" />
            </div>
          )}
          <div className="space-y-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(event) => void handlePosterUpload(event)} />
              {isPosterUploading ? 'Uploading…' : form.posterUrl ? 'Replace image' : 'Upload image'}
            </label>
            <p className="text-xs text-stone-400">Use upload only. Image links are not required.</p>
            {form.posterUrl ? (
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, posterUrl: '' }))}
                className="block text-xs text-red-400 transition hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,

    <div key="schedule" className="space-y-4">
      <p className="text-sm leading-relaxed text-stone-400">Set the fundraiser date and optional sales cutoff.</p>
      <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-400">Date & time</label>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-400">
            Sales cutoff <span className="text-stone-300">(optional)</span>
          </label>
          <input
            type="datetime-local"
            value={form.salesCutoffAt}
            onChange={(event) => setForm((prev) => ({ ...prev, salesCutoffAt: event.target.value }))}
            className={inputClass}
          />
        </div>
      </div>
    </div>,

    <div key="tickets" className="space-y-5">
      <div>
        <label className={labelClass}>Pricing Tiers</label>
        <p className="mb-2 text-xs text-stone-300">
          One per line - <code className="rounded bg-stone-100 px-1 text-stone-500">Name:PriceCents</code>
        </p>
        <textarea
          value={form.tiersText}
          onChange={(event) => setForm((prev) => ({ ...prev, tiersText: event.target.value }))}
          rows={4}
          placeholder={'Adult:1800\nStudent:1200'}
          className={`${inputClass} resize-none font-sans text-xs`}
        />
        {tiers.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {tiers.map((tier) => (
              <span
                key={`${tier.name}-${tier.priceCents}`}
                className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
              >
                {tier.name} · ${(tier.priceCents / 100).toFixed(2)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-800">Seat selection on checkout</p>
            <p className="text-xs text-stone-500">
              On: buyers pick seats. Off: buyers pick quantity and seats are auto-assigned.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.seatSelectionEnabled}
            onClick={() => setForm((prev) => ({ ...prev, seatSelectionEnabled: !prev.seatSelectionEnabled }))}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              form.seatSelectionEnabled
                ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                : 'border-stone-200 bg-stone-100 text-stone-500'
            }`}
          >
            {form.seatSelectionEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>,

    <div key="review" className="space-y-4">
      <p className="text-sm text-stone-400">Review fundraiser details before saving.</p>
      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white divide-y divide-stone-100">
        {[
          { label: 'Title', value: form.title || <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Description', value: form.description || <span className="text-stone-300">None</span> },
          { label: 'Venue', value: form.venue || <span className="font-semibold text-red-400">Missing!</span> },
          {
            label: 'Date',
            value: form.startsAt
              ? new Date(form.startsAt).toLocaleString()
              : <span className="font-semibold text-red-400">Missing!</span>
          },
          {
            label: 'Cutoff',
            value: form.salesCutoffAt ? new Date(form.salesCutoffAt).toLocaleString() : <span className="text-stone-300">None</span>
          },
          {
            label: 'Pricing',
            value:
              tiers.length > 0
                ? tiers.map((tier) => `${tier.name} $${(tier.priceCents / 100).toFixed(2)}`).join(' · ')
                : <span className="font-semibold text-red-400">Missing!</span>
          },
          {
            label: 'Seat selection',
            value: form.seatSelectionEnabled ? 'Enabled' : 'Auto-assign mode'
          }
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-stone-400">{label}</span>
            <span className="max-w-full font-semibold text-stone-800 sm:max-w-[58%] sm:text-right">{value}</span>
          </div>
        ))}
      </div>
      {form.posterUrl ? (
        <div className="flex items-center gap-3">
          <img
            src={form.posterUrl}
            alt="Poster preview"
            className="h-14 w-10 rounded-lg border border-stone-100 object-cover shadow-sm"
          />
          <span className="text-sm text-stone-400">Poster attached</span>
          <Check className="h-4 w-4 text-green-500" />
        </div>
      ) : (
        <p className="text-xs text-stone-400">No poster uploaded yet.</p>
      )}
    </div>
  ];

  const sponsorStepContent: ReactNode[] = [
    <div key="sponsor-brand" className="space-y-5">
      <div>
        <label className={labelClass}>Sponsor Name</label>
        <input
          value={sponsorForm.name}
          onChange={(event) => setSponsorForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="e.g. Main Street Bank"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Sponsorship Tier</label>
        <select
          value={sponsorForm.tier}
          onChange={(event) => setSponsorForm((prev) => ({ ...prev, tier: event.target.value as SponsorForm['tier'] }))}
          className={inputClass}
        >
          <option value="Gold">Gold</option>
          <option value="Silver">Silver</option>
          <option value="Bronze">Bronze</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Website URL</label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-300" />
          <input
            value={sponsorForm.websiteUrl}
            onChange={(event) => setSponsorForm((prev) => ({ ...prev, websiteUrl: event.target.value }))}
            placeholder="https://example.com"
            className={`${inputClass} pl-10`}
          />
        </div>
      </div>
    </div>,

    <div key="sponsor-media" className="space-y-5">
      <div>
        <label className={labelClass}>Sponsor Logo</label>
        <div className="flex items-start gap-3">
          {sponsorForm.logoUrl ? (
            <img
              src={sponsorForm.logoUrl}
              alt="Sponsor logo"
              className="h-16 w-24 rounded-xl border border-stone-100 object-contain bg-white p-2"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-xl bg-stone-100">
              <ImageIcon className="h-5 w-5 text-stone-300" />
            </div>
          )}
          <div className="space-y-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleSponsorLogoUpload(event)} />
              {isSponsorLogoUploading ? 'Uploading…' : sponsorForm.logoUrl ? 'Replace logo' : 'Upload logo'}
            </label>
            {sponsorForm.logoUrl ? (
              <button
                type="button"
                onClick={() => setSponsorForm((prev) => ({ ...prev, logoUrl: '' }))}
                className="block text-xs text-red-400 transition hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Sponsor Spotlight Image</label>
        <div className="flex items-start gap-3">
          {sponsorForm.imageUrl ? (
            <img
              src={sponsorForm.imageUrl}
              alt="Sponsor spotlight"
              className="h-20 w-32 rounded-xl border border-stone-100 object-cover"
            />
          ) : (
            <div className="flex h-20 w-32 items-center justify-center rounded-xl bg-stone-100">
              <ImageIcon className="h-5 w-5 text-stone-300" />
            </div>
          )}
          <div className="space-y-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleSponsorImageUpload(event)} />
              {isSponsorImageUploading ? 'Uploading…' : sponsorForm.imageUrl ? 'Replace image' : 'Upload image'}
            </label>
            {sponsorForm.imageUrl ? (
              <button
                type="button"
                onClick={() => setSponsorForm((prev) => ({ ...prev, imageUrl: '' }))}
                className="block text-xs text-red-400 transition hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Sponsor Spotlight Text</label>
        <textarea
          value={sponsorForm.spotlight}
          onChange={(event) => setSponsorForm((prev) => ({ ...prev, spotlight: event.target.value }))}
          rows={4}
          className={`${inputClass} resize-none`}
          placeholder="Share how this sponsor supports the theater program."
        />
      </div>
    </div>,

    <div key="sponsor-review" className="space-y-4">
      <p className="text-sm text-stone-400">Review sponsor details before saving.</p>
      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white divide-y divide-stone-100">
        {[
          { label: 'Name', value: sponsorForm.name || <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Tier', value: sponsorForm.tier },
          { label: 'Website', value: sponsorForm.websiteUrl || <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Spotlight', value: sponsorForm.spotlight || <span className="text-stone-300">Missing</span> },
          { label: 'Logo', value: sponsorForm.logoUrl ? 'Uploaded' : <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Image', value: sponsorForm.imageUrl ? 'Uploaded' : <span className="font-semibold text-red-400">Missing!</span> }
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-stone-400">{label}</span>
            <span className="max-w-full font-semibold text-stone-800 sm:max-w-[58%] sm:text-right">{value}</span>
          </div>
        ))}
      </div>
      {sponsorForm.logoUrl && sponsorForm.imageUrl ? (
        <div className="flex items-center gap-3">
          <img src={sponsorForm.logoUrl} alt="Logo preview" className="h-10 w-16 rounded-lg border border-stone-100 object-contain bg-white p-1.5" />
          <img src={sponsorForm.imageUrl} alt="Image preview" className="h-10 w-16 rounded-lg border border-stone-100 object-cover" />
          <Check className="h-4 w-4 text-green-500" />
        </div>
      ) : null}
    </div>
  ];

  return (
    <div className="space-y-6" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Fundraise</h1>
          <p className="text-sm text-stone-600">
            Create fundraising events with the same guided workflow as performances.
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={tab === 'events' ? startNewEvent : startNewSponsor}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-red-100 transition hover:bg-red-800 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          {tab === 'events' ? 'New Fundraising Event' : 'New Sponsor'}
        </motion.button>
      </div>

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {sponsorError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sponsorError}</div>
      ) : null}

      <div className="inline-flex rounded-xl border border-stone-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setTab('events')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'events' ? 'bg-rose-700 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Events
        </button>
        <button
          type="button"
          onClick={() => setTab('sponsors')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'sponsors' ? 'bg-rose-700 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Sponsors
        </button>
      </div>

      {tab === 'events' ? (
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-stone-200 bg-white py-14 text-center text-sm text-stone-500">
              Loading fundraising events...
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 py-14 text-center text-sm text-stone-400">
              No fundraising events yet.
            </div>
          ) : (
            events.map((event, idx) => {
              const pct = event.seatsTotal > 0 ? Math.round((event.seatsSold / event.seatsTotal) * 100) : 0;
              const isSelected = event.id === selectedEvent?.id;
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`flex flex-col gap-4 rounded-2xl border bg-white p-4 transition-all hover:shadow-md sm:flex-row ${
                    isSelected ? 'border-rose-200 shadow-sm shadow-rose-100' : 'border-stone-100 hover:border-stone-200'
                  }`}
                >
                  {event.showPosterUrl ? (
                    <img
                      src={event.showPosterUrl}
                      alt={event.title}
                      className="h-16 w-12 flex-shrink-0 rounded-xl border border-stone-100 object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-stone-100">
                      <ImageIcon className="h-4 w-4 text-stone-300" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-bold text-stone-900">{event.title}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditEvent(event)}
                          className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-500 transition hover:bg-stone-50 hover:text-stone-900"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void archiveEvent(event)}
                          className="rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-50"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-stone-400">
                      <Calendar className="h-3 w-3" />
                      {new Date(event.startsAt).toLocaleString()}
                      <span className="text-stone-200">·</span>
                      <MapPin className="h-3 w-3" />
                      {event.venue}
                    </p>
                    <div className="mt-2.5">
                      <div className="mb-1 flex justify-between text-xs text-stone-400">
                        <span>
                          {event.seatsSold} / {event.seatsTotal} seats
                        </span>
                        <span className={pct >= 90 ? 'font-bold text-red-500' : pct >= 60 ? 'font-semibold text-amber-500' : ''}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: idx * 0.05 + 0.2 }}
                          className={`h-full rounded-full ${
                            pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                        {event.seatSelectionEnabled ? 'Seat map checkout' : 'Auto-assign checkout'}
                      </span>
                      {event.pricingTiers.map((tier) => (
                        <span key={tier.id} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                          {tier.name} ${(tier.priceCents / 100).toFixed(2)}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Sponsor Showcase</h2>
              <p className="mt-1 text-sm text-stone-600">
                Upload-first sponsor management. Changes here update the public fundraising sponsor section.
              </p>
            </div>
            <button
              type="button"
              onClick={startNewSponsor}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
            >
              <Plus className="h-4 w-4" />
              New Sponsor
            </button>
          </div>

          {sponsorsLoading ? (
            <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
              Loading sponsors...
            </div>
          ) : sponsors.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500">
              No sponsors yet. Add your first sponsor to populate the public banner and sponsor grid.
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sponsors.map((sponsor) => (
                <article key={sponsor.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  <img src={sponsor.imageUrl} alt={`${sponsor.name} spotlight`} className="h-36 w-full object-cover" />
                  <div className="p-4">
                    <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600">
                      <Landmark className="h-3.5 w-3.5" />
                      {sponsor.tier}
                    </div>
                    <div className="mb-3 flex h-10 items-center">
                      <img src={sponsor.logoUrl} alt={sponsor.name} className="h-9 w-auto object-contain" />
                    </div>
                    <p className="text-sm font-semibold text-stone-900">{sponsor.name}</p>
                    <p className="mt-1 text-sm text-stone-600">{sponsor.spotlight}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEditSponsor(sponsor)}
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-50"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSponsor(sponsor)}
                        disabled={deletingSponsorId === sponsor.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingSponsorId === sponsor.id ? 'Deleting…' : 'Delete'}
                      </button>
                      <a
                        href={sponsor.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-xs font-semibold text-rose-700 hover:text-rose-800"
                      >
                        Visit Sponsor
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {showWizard ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.93, opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
            >
              <div className="mb-0 border-b border-stone-100 px-4 pb-4 pt-5 sm:px-6 flex-shrink-0">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-bold text-stone-900">{editingId ? 'Edit Fundraising Event' : 'New Fundraising Event'}</p>
                  <button
                    type="button"
                    onClick={closeWizard}
                    className="rounded-full p-1 text-stone-300 transition hover:bg-stone-50 hover:text-stone-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STEPS.map((wizardStep, idx) => {
                    const Icon = wizardStep.icon;
                    const done = idx < step;
                    const active = idx === step;
                    return (
                      <button
                        key={wizardStep.id}
                        type="button"
                        onClick={() => goTo(idx)}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                          active
                            ? 'bg-red-700 text-white shadow-sm'
                            : done
                              ? 'border border-green-200 bg-green-50 text-green-700'
                              : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                        }`}
                      >
                        {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                        <span className="hidden sm:inline">{wizardStep.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ x: dir * 32, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: dir * -32, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {stepContent[step]}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="flex-shrink-0 border-t border-stone-100 bg-stone-50/60 px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => goTo(step - 1)}
                    disabled={step === 0}
                    className="flex items-center gap-1 text-sm font-semibold text-stone-400 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <span className="text-xs text-stone-300">
                    {step + 1} / {STEPS.length}
                  </span>
                  {step < STEPS.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => goTo(step + 1)}
                      className="flex items-center gap-1.5 rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={() => void saveEvent()}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      disabled={saving}
                      className="flex items-center gap-1.5 rounded-full bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-red-100 transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Event'}
                    </motion.button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showSponsorWizard ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.93, opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
            >
              <div className="mb-0 border-b border-stone-100 px-4 pb-4 pt-5 sm:px-6 flex-shrink-0">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-bold text-stone-900">{sponsorEditingId ? 'Edit Sponsor' : 'New Sponsor'}</p>
                  <button
                    type="button"
                    onClick={closeSponsorWizard}
                    className="rounded-full p-1 text-stone-300 transition hover:bg-stone-50 hover:text-stone-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SPONSOR_STEPS.map((wizardStep, idx) => {
                    const Icon = wizardStep.icon;
                    const done = idx < sponsorStep;
                    const active = idx === sponsorStep;
                    return (
                      <button
                        key={wizardStep.id}
                        type="button"
                        onClick={() => goToSponsorStep(idx)}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                          active
                            ? 'bg-red-700 text-white shadow-sm'
                            : done
                              ? 'border border-green-200 bg-green-50 text-green-700'
                              : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                        }`}
                      >
                        {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                        <span className="hidden sm:inline">{wizardStep.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={sponsorStep}
                    initial={{ x: sponsorDir * 32, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: sponsorDir * -32, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {sponsorStepContent[sponsorStep]}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="flex-shrink-0 border-t border-stone-100 bg-stone-50/60 px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => goToSponsorStep(sponsorStep - 1)}
                    disabled={sponsorStep === 0}
                    className="flex items-center gap-1 text-sm font-semibold text-stone-400 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <span className="text-xs text-stone-300">
                    {sponsorStep + 1} / {SPONSOR_STEPS.length}
                  </span>
                  {sponsorStep < SPONSOR_STEPS.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => goToSponsorStep(sponsorStep + 1)}
                      className="flex items-center gap-1.5 rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={() => void saveSponsor()}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      disabled={sponsorSaving}
                      className="flex items-center gap-1.5 rounded-full bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-red-100 transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {sponsorSaving ? 'Saving...' : sponsorEditingId ? 'Save Sponsor' : 'Create Sponsor'}
                    </motion.button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
