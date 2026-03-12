import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type CastMember = {
  id?: string;
  name: string;
  role: string;
  photoUrl?: string | null;
};

type Performance = {
  id: string;
  title: string;
  showDescription?: string | null;
  showPosterUrl?: string | null;
  showType?: string | null;
  showYear?: number | null;
  showAccentColor?: string | null;
  startsAt: string;
  salesCutoffAt: string | null;
  staffCompsEnabled: boolean;
  staffCompLimitPerUser: number;
  staffTicketLimit: number;
  familyFreeTicketEnabled: boolean;
  venue: string;
  notes?: string | null;
  seatsTotal: number;
  seatsSold: number;
  paidOrders: number;
  pricingTiers: Array<{ id: string; name: string; priceCents: number }>;
  castMembers: CastMember[];
};

type FormCastMember = {
  name: string;
  role: string;
  photoUrl: string;
};

type FormState = {
  title: string;
  posterUrl: string;
  startsAt: string;
  salesCutoffAt: string;
  staffCompsEnabled: boolean;
  staffCompLimitPerUser: number;
  staffTicketLimit: number;
  familyFreeTicketEnabled: boolean;
  venue: string;
  notes: string;
  tiersText: string;
  castMembers: FormCastMember[];
};

function emptyCastMember(): FormCastMember {
  return {
    name: '',
    role: '',
    photoUrl: ''
  };
}

function createInitialForm(): FormState {
  return {
    title: '',
    posterUrl: '',
    startsAt: '',
    salesCutoffAt: '',
    staffCompsEnabled: true,
    staffCompLimitPerUser: 1,
    staffTicketLimit: 2,
    familyFreeTicketEnabled: false,
    venue: 'Penncrest High School Auditorium',
    notes: '',
    tiersText: 'Adult:1800\nStudent:1200\nChild:1000\nSenior:1400',
    castMembers: [emptyCastMember()]
  };
}

function parseTiers(tiersText: string): Array<{ name: string; priceCents: number }> {
  return tiersText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [namePart, pricePart = ''] = line.split(':');
      return { name: namePart.trim(), priceCents: Number(pricePart) };
    })
    .filter((tier) => tier.name.length > 0 && Number.isFinite(tier.priceCents) && tier.priceCents > 0);
}

function fileToDataUrl(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to parse uploaded image.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load uploaded image.'));
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Could not process image.'));
          return;
        }

        context.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const compressed = canvas.toDataURL(mimeType, mimeType === 'image/png' ? undefined : 0.82);
        resolve(compressed);
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

export default function AdminPerformancesPage() {
  const [items, setItems] = useState<Performance[]>([]);
  const [form, setForm] = useState<FormState>(() => createInitialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingCastIndex, setUploadingCastIndex] = useState<number | null>(null);
  const [isPosterUploading, setIsPosterUploading] = useState(false);

  const tiers = useMemo(() => parseTiers(form.tiersText), [form.tiersText]);

  const load = () => {
    adminFetch<Performance[]>('/api/admin/performances')
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performances'));
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (tiers.length === 0) {
      setError('Provide at least one pricing tier in Name:Price format.');
      return;
    }

    const normalizedCast = form.castMembers.map((member) => ({
      name: member.name.trim(),
      role: member.role.trim(),
      photoUrl: member.photoUrl.trim()
    }));

    const hasInvalidCastRow = normalizedCast.some(
      (member) => (member.name || member.role || member.photoUrl) && (!member.name || !member.role)
    );

    if (hasInvalidCastRow) {
      setError('Each cast member row must include both Name and Role.');
      return;
    }

    const castMembers = normalizedCast
      .filter((member) => member.name.length > 0 && member.role.length > 0)
      .map((member) => ({
        name: member.name,
        role: member.role,
        photoUrl: member.photoUrl || undefined
      }));

    const payload = {
      title: form.title,
      posterUrl: form.posterUrl.trim() || undefined,
      startsAt: new Date(form.startsAt).toISOString(),
      salesCutoffAt: form.salesCutoffAt ? new Date(form.salesCutoffAt).toISOString() : null,
      staffCompsEnabled: form.staffCompsEnabled,
      staffCompLimitPerUser: form.staffCompLimitPerUser,
      staffTicketLimit: form.staffTicketLimit,
      familyFreeTicketEnabled: form.familyFreeTicketEnabled,
      venue: form.venue,
      notes: form.notes,
      pricingTiers: tiers,
      castMembers
    };

    try {
      if (editingId) {
        await adminFetch(`/api/admin/performances/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      } else {
        await adminFetch('/api/admin/performances', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      setEditingId(null);
      setForm(createInitialForm());
      setUploadingCastIndex(null);
      setIsPosterUploading(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save performance');
    }
  };

  const startEditing = (item: Performance) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      posterUrl: item.showPosterUrl || '',
      startsAt: item.startsAt.slice(0, 16),
      salesCutoffAt: item.salesCutoffAt ? item.salesCutoffAt.slice(0, 16) : '',
      staffCompsEnabled: item.staffCompsEnabled,
      staffCompLimitPerUser: item.staffCompLimitPerUser || 1,
      staffTicketLimit: item.staffTicketLimit || 2,
      familyFreeTicketEnabled: item.familyFreeTicketEnabled || false,
      venue: item.venue,
      notes: item.notes || '',
      tiersText: item.pricingTiers.map((tier) => `${tier.name}:${tier.priceCents}`).join('\n'),
      castMembers:
        item.castMembers.length > 0
          ? item.castMembers.map((member) => ({
              name: member.name,
              role: member.role,
              photoUrl: member.photoUrl || ''
            }))
          : [emptyCastMember()]
    });
    setIsPosterUploading(false);
  };

  const updateCastMember = (index: number, next: Partial<FormCastMember>) => {
    setForm((prev) => ({
      ...prev,
      castMembers: prev.castMembers.map((member, memberIndex) =>
        memberIndex === index
          ? {
              ...member,
              ...next
            }
          : member
      )
    }));
  };

  const addCastMemberRow = () => {
    setForm((prev) => ({
      ...prev,
      castMembers: [...prev.castMembers, emptyCastMember()]
    }));
  };

  const removeCastMemberRow = (index: number) => {
    setForm((prev) => {
      if (prev.castMembers.length <= 1) {
        return {
          ...prev,
          castMembers: [emptyCastMember()]
        };
      }

      return {
        ...prev,
        castMembers: prev.castMembers.filter((_member, memberIndex) => memberIndex !== index)
      };
    });
  };

  const handleCastImageUpload = async (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file for cast member photos.');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('Image is too large. Use a file under 8MB.');
      return;
    }

    setError(null);
    setUploadingCastIndex(index);

    try {
      const photoUrl = await fileToDataUrl(file, 640, 860);
      updateCastMember(index, { photoUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload cast image');
    } finally {
      setUploadingCastIndex(null);
    }
  };

  const handlePosterUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file for the poster.');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('Poster image is too large. Use a file under 8MB.');
      return;
    }

    setError(null);
    setIsPosterUploading(true);

    try {
      const posterUrl = await fileToDataUrl(file, 1200, 1800);
      setForm((prev) => ({
        ...prev,
        posterUrl
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload poster image');
    } finally {
      setIsPosterUploading(false);
    }
  };

  const archivePerformance = async (item: Performance) => {
    if (!confirm(`Archive "${item.title}"? It will be hidden from public sales but all order and seat data will be kept.`)) {
      return;
    }

    try {
      setError(null);
      await adminFetch(`/api/admin/performances/${item.id}/archive`, { method: 'POST' });
      if (editingId === item.id) {
        setEditingId(null);
        setForm(createInitialForm());
        setUploadingCastIndex(null);
        setIsPosterUploading(false);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive performance');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900 mb-5">Performances</h1>
      <p className="text-sm text-stone-600 mb-5">Archived performances are managed in the Archive tab.</p>

      <form onSubmit={submit} className="border border-stone-200 rounded-2xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Show title" required className="border border-stone-300 rounded-xl px-3 py-2" />
          <input
            value={form.posterUrl}
            onChange={(event) => setForm({ ...form, posterUrl: event.target.value })}
            placeholder="Poster URL"
            className="border border-stone-300 rounded-xl px-3 py-2"
          />
          <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required className="border border-stone-300 rounded-xl px-3 py-2" />
          <input type="datetime-local" value={form.salesCutoffAt} onChange={(event) => setForm({ ...form, salesCutoffAt: event.target.value })} className="border border-stone-300 rounded-xl px-3 py-2" placeholder="Sales cutoff" />
          <input value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })} placeholder="Venue" required className="border border-stone-300 rounded-xl px-3 py-2" />
          <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notes" className="border border-stone-300 rounded-xl px-3 py-2" />
          <div className="text-sm text-stone-600 border border-stone-200 rounded-xl px-3 py-2 bg-stone-50">
            Verified staff comp limit per user: 1
          </div>
          <input
            type="number"
            min={1}
            max={10}
            value={form.staffTicketLimit}
            onChange={(event) => setForm({ ...form, staffTicketLimit: Math.max(1, Number(event.target.value) || 1) })}
            placeholder="Staff free ticket limit"
            className="border border-stone-300 rounded-xl px-3 py-2"
          />
          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.staffCompsEnabled}
              onChange={(event) => setForm({ ...form, staffCompsEnabled: event.target.checked })}
            />
            Enable verified staff comp redemptions
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.familyFreeTicketEnabled}
              onChange={(event) => setForm({ ...form, familyFreeTicketEnabled: event.target.checked })}
            />
            Enable one free family ticket per show run
          </label>
        </div>

        <div className="rounded-xl border border-stone-200 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Show Poster</h2>
              <p className="text-xs text-stone-500">Paste an image URL or upload a poster file.</p>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handlePosterUpload(event);
                }}
              />
              {isPosterUploading ? 'Uploading...' : 'Upload Poster'}
            </label>
          </div>

          {form.posterUrl ? (
            <div className="flex items-start gap-3">
              <img src={form.posterUrl} alt="Show poster preview" className="h-28 w-20 rounded-md object-cover border border-stone-200" />
              <button
                type="button"
                className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                onClick={() => setForm({ ...form, posterUrl: '' })}
              >
                Remove poster
              </button>
            </div>
          ) : null}
        </div>

        <textarea
          value={form.tiersText}
          onChange={(event) => setForm({ ...form, tiersText: event.target.value })}
          rows={3}
          className="w-full border border-stone-300 rounded-xl px-3 py-2"
          placeholder="Adult:1800\nStudent:1200"
        />

        <div className="rounded-xl border border-stone-200 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Cast Members</h2>
              <p className="text-xs text-stone-500">Name, role, and optional headshot for the show detail page.</p>
            </div>
            <button type="button" onClick={addCastMemberRow} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
              Add Member
            </button>
          </div>

          <div className="space-y-3">
            {form.castMembers.map((member, index) => (
              <div key={`cast-${index}`} className="rounded-lg border border-stone-200 p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    value={member.name}
                    onChange={(event) => updateCastMember(index, { name: event.target.value })}
                    placeholder="Name"
                    className="border border-stone-300 rounded-xl px-3 py-2"
                  />
                  <input
                    value={member.role}
                    onChange={(event) => updateCastMember(index, { role: event.target.value })}
                    placeholder="Role"
                    className="border border-stone-300 rounded-xl px-3 py-2"
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        void handleCastImageUpload(index, event);
                      }}
                    />
                    {uploadingCastIndex === index ? 'Uploading...' : member.photoUrl ? 'Replace photo' : 'Click to upload'}
                  </label>
                  {member.photoUrl ? (
                    <button
                      type="button"
                      className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                      onClick={() => updateCastMember(index, { photoUrl: '' })}
                    >
                      Remove photo
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                    onClick={() => removeCastMemberRow(index)}
                  >
                    Remove member
                  </button>
                </div>

                {member.photoUrl ? (
                  <div className="mt-3">
                    <img src={member.photoUrl} alt={member.name || 'Cast member preview'} className="h-20 w-16 rounded-md object-cover border border-stone-200" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="w-full rounded-lg bg-red-700 px-4 py-2 font-bold text-white sm:w-auto">
            {editingId ? 'Update Performance' : 'Create Performance'}
          </button>
          {editingId && (
            <button
              type="button"
              className="w-full rounded-lg border border-stone-300 px-4 py-2 sm:w-auto"
              onClick={() => {
                setEditingId(null);
                setForm(createInitialForm());
                setUploadingCastIndex(null);
                setIsPosterUploading(false);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="space-y-3">
        {items.length === 0 ? <div className="text-sm text-stone-500">No active performances.</div> : null}
        {items.map((item) => (
          <div key={item.id} className="flex flex-col gap-4 rounded-xl border border-stone-200 p-3 sm:flex-row sm:justify-between">
            <div>
              <div className="font-bold text-stone-900">{item.title}</div>
              <div className="text-xs text-stone-500">{new Date(item.startsAt).toLocaleString()} • {item.venue}</div>
              <div className="text-xs text-stone-500">
                Sales cutoff: {item.salesCutoffAt ? new Date(item.salesCutoffAt).toLocaleString() : 'At showtime'}
              </div>
              <div className="text-xs text-stone-500">
                Staff comps: {item.staffCompsEnabled ? `Enabled (${item.staffCompLimitPerUser}/user)` : 'Disabled'} •
                {' '}
                Legacy staff limit: {item.staffTicketLimit} • Family free: {item.familyFreeTicketEnabled ? 'Enabled' : 'Disabled'}
              </div>
              <div className="text-xs text-stone-500">{item.seatsSold}/{item.seatsTotal} sold</div>
              <div className="text-xs text-stone-500">Tiers: {item.pricingTiers.map((tier) => `${tier.name} $${(tier.priceCents / 100).toFixed(2)}`).join(', ')}</div>
              <div className="text-xs text-stone-500">Cast members: {item.castMembers.length}</div>
              <div className="text-xs text-stone-500">Paid orders: {item.paidOrders}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                className="w-full rounded-md border border-stone-300 px-3 py-1 text-sm sm:w-auto"
                onClick={() => startEditing(item)}
              >
                Edit
              </button>
              <button
                className="w-full rounded-md border border-amber-300 px-3 py-1 text-sm text-amber-700 sm:w-auto"
                onClick={() => {
                  void archivePerformance(item);
                }}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
