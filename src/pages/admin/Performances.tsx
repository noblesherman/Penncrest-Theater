import { FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type Performance = {
  id: string;
  title: string;
  startsAt: string;
  salesCutoffAt: string | null;
  staffCompsEnabled: boolean;
  staffCompLimitPerUser: number;
  staffTicketLimit: number;
  familyFreeTicketEnabled: boolean;
  venue: string;
  seatsTotal: number;
  seatsSold: number;
  paidOrders: number;
  pricingTiers: Array<{ id: string; name: string; priceCents: number }>;
};

type FormState = {
  title: string;
  startsAt: string;
  salesCutoffAt: string;
  staffCompsEnabled: boolean;
  staffCompLimitPerUser: number;
  staffTicketLimit: number;
  familyFreeTicketEnabled: boolean;
  venue: string;
  notes: string;
  tiersText: string;
};

const initialForm: FormState = {
  title: '',
  startsAt: '',
  salesCutoffAt: '',
  staffCompsEnabled: true,
  staffCompLimitPerUser: 1,
  staffTicketLimit: 2,
  familyFreeTicketEnabled: false,
  venue: 'Penncrest High School Auditorium',
  notes: '',
  tiersText: 'Adult:1800\nStudent:1200\nChild:1000\nSenior:1400'
};

function parseTiers(tiersText: string): Array<{ name: string; priceCents: number }> {
  return tiersText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, price] = line.split(':');
      return { name: name.trim(), priceCents: Number(price) };
    })
    .filter((tier) => tier.name.length > 0 && Number.isFinite(tier.priceCents) && tier.priceCents > 0);
}

export default function AdminPerformancesPage() {
  const [items, setItems] = useState<Performance[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    const payload = {
      title: form.title,
      startsAt: new Date(form.startsAt).toISOString(),
      salesCutoffAt: form.salesCutoffAt ? new Date(form.salesCutoffAt).toISOString() : null,
      staffCompsEnabled: form.staffCompsEnabled,
      staffCompLimitPerUser: form.staffCompLimitPerUser,
      staffTicketLimit: form.staffTicketLimit,
      familyFreeTicketEnabled: form.familyFreeTicketEnabled,
      venue: form.venue,
      notes: form.notes,
      pricingTiers: tiers
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
      setForm(initialForm);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save performance');
    }
  };

  const startEditing = (item: Performance) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      startsAt: item.startsAt.slice(0, 16),
      salesCutoffAt: item.salesCutoffAt ? item.salesCutoffAt.slice(0, 16) : '',
      staffCompsEnabled: item.staffCompsEnabled,
      staffCompLimitPerUser: item.staffCompLimitPerUser || 1,
      staffTicketLimit: item.staffTicketLimit || 2,
      familyFreeTicketEnabled: item.familyFreeTicketEnabled || false,
      venue: item.venue,
      notes: '',
      tiersText: item.pricingTiers.map((tier) => `${tier.name}:${tier.priceCents}`).join('\n')
    });
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
        setForm(initialForm);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive performance');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-900 mb-5">Performances</h1>
      <p className="text-sm text-stone-600 mb-5">Archived performances are managed in the Archive tab.</p>

      <form onSubmit={submit} className="border border-stone-200 rounded-2xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Show title" required className="border border-stone-300 rounded-xl px-3 py-2" />
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

        <textarea
          value={form.tiersText}
          onChange={(event) => setForm({ ...form, tiersText: event.target.value })}
          rows={3}
          className="w-full border border-stone-300 rounded-xl px-3 py-2"
          placeholder="Adult:1800\nStudent:1200"
        />

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <div className="flex gap-2">
          <button type="submit" className="bg-stone-900 text-white px-4 py-2 rounded-lg font-bold">
            {editingId ? 'Update Performance' : 'Create Performance'}
          </button>
          {editingId && (
            <button
              type="button"
              className="border border-stone-300 px-4 py-2 rounded-lg"
              onClick={() => {
                setEditingId(null);
                setForm(initialForm);
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
          <div key={item.id} className="border border-stone-200 rounded-xl p-3 flex justify-between gap-4">
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
              <div className="text-xs text-stone-500">Paid orders: {item.paidOrders}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="text-sm px-3 py-1 rounded-md border border-stone-300"
                onClick={() => startEditing(item)}
              >
                Edit
              </button>
              <button
                className="text-sm px-3 py-1 rounded-md border border-amber-300 text-amber-700"
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
