import { FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch, getAdminToken } from '../../lib/adminAuth';
import { apiUrl } from '../../lib/api';
import { uploadAdminPdf } from '../../lib/adminUploads';

type TripSummary = {
  id: string;
  title: string;
  slug: string;
  destination: string | null;
  dueAt: string;
  startsAt: string | null;
  defaultCostCents: number;
  allowPartialPayments: boolean;
  isPublished: boolean;
  isArchived: boolean;
  _count?: {
    enrollments: number;
    documents: number;
  };
};

type TripDetail = TripSummary & {
  documents: Array<{
    id: string;
    title: string;
    fileUrl: string;
    fileKey: string | null;
    mimeType: string;
    sizeBytes: number;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
  }>;
};

type RosterRow = {
  id: string;
  student: {
    id: string;
    name: string;
    grade: string | null;
  };
  targetAmountCents: number;
  paidAmountCents: number;
  remainingAmountCents: number;
  dueAt: string;
  dueAtOverride: string | null;
  claimedByAccount: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  claimedAt: string | null;
};

type LedgerSummary = {
  targetAmountCents: number;
  collectedAmountCents: number;
  pendingAmountCents: number;
  remainingAmountCents: number;
};

type LedgerPayment = {
  id: string;
  studentName: string;
  accountEmail: string;
  amountCents: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>('');
  const [selectedTrip, setSelectedTrip] = useState<TripDetail | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [ledgerPayments, setLedgerPayments] = useState<LedgerPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    title: '',
    slug: '',
    destination: '',
    startsAt: '',
    dueAt: '',
    defaultCostDollars: '0',
    allowPartialPayments: false,
    isPublished: false
  });

  const [editForm, setEditForm] = useState({
    title: '',
    slug: '',
    destination: '',
    startsAt: '',
    dueAt: '',
    defaultCostDollars: '0',
    allowPartialPayments: false,
    isPublished: false,
    isArchived: false
  });

  const [documentTitle, setDocumentTitle] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [manualStudentName, setManualStudentName] = useState('');
  const [manualStudentGrade, setManualStudentGrade] = useState('');
  const [manualTargetDollars, setManualTargetDollars] = useState('');
  const [manualDueAt, setManualDueAt] = useState('');
  const [csvText, setCsvText] = useState('');
  const [overrideTargetByEnrollmentId, setOverrideTargetByEnrollmentId] = useState<Record<string, string>>({});
  const [overrideDueAtByEnrollmentId, setOverrideDueAtByEnrollmentId] = useState<Record<string, string>>({});

  const selectedTripSummary = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) || null,
    [selectedTripId, trips]
  );

  async function loadTrips(preserveSelected = true): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminFetch<{ trips: TripSummary[] }>('/api/admin/trips');
      setTrips(payload.trips);

      if (payload.trips.length === 0) {
        setSelectedTripId('');
        setSelectedTrip(null);
        setRoster([]);
        setLedgerSummary(null);
        setLedgerPayments([]);
        return;
      }

      const keepId = preserveSelected ? selectedTripId : '';
      const nextId = keepId && payload.trips.some((trip) => trip.id === keepId) ? keepId : payload.trips[0].id;
      setSelectedTripId(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trips');
    } finally {
      setLoading(false);
    }
  }

  async function loadTripData(tripId: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [tripRes, rosterRes, ledgerRes] = await Promise.all([
        adminFetch<{ trip: TripDetail }>(`/api/admin/trips/${encodeURIComponent(tripId)}`),
        adminFetch<{ roster: RosterRow[] }>(`/api/admin/trips/${encodeURIComponent(tripId)}/roster`),
        adminFetch<{ summary: LedgerSummary; payments: LedgerPayment[] }>(`/api/admin/trips/${encodeURIComponent(tripId)}/ledger`)
      ]);

      setSelectedTrip(tripRes.trip);
      setRoster(rosterRes.roster);
      setLedgerSummary(ledgerRes.summary);
      setLedgerPayments(ledgerRes.payments);
      setEditForm({
        title: tripRes.trip.title,
        slug: tripRes.trip.slug,
        destination: tripRes.trip.destination || '',
        startsAt: toDatetimeLocal(tripRes.trip.startsAt),
        dueAt: toDatetimeLocal(tripRes.trip.dueAt),
        defaultCostDollars: (tripRes.trip.defaultCostCents / 100).toFixed(2),
        allowPartialPayments: tripRes.trip.allowPartialPayments,
        isPublished: tripRes.trip.isPublished,
        isArchived: tripRes.trip.isArchived
      });
      setOverrideTargetByEnrollmentId(
        Object.fromEntries(rosterRes.roster.map((row) => [row.id, (row.targetAmountCents / 100).toFixed(2)]))
      );
      setOverrideDueAtByEnrollmentId(
        Object.fromEntries(rosterRes.roster.map((row) => [row.id, toDatetimeLocal(row.dueAtOverride || row.dueAt)]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trip details');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTrips(false);
  }, []);

  useEffect(() => {
    if (!selectedTripId) return;
    void loadTripData(selectedTripId);
  }, [selectedTripId]);

  async function handleCreateTrip(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const defaultCostCents = Math.round(Number.parseFloat(createForm.defaultCostDollars || '0') * 100);
    const startsAt = fromDatetimeLocal(createForm.startsAt);
    const dueAt = fromDatetimeLocal(createForm.dueAt);
    if (!dueAt) {
      setError('Due date is required.');
      return;
    }

    try {
      const response = await adminFetch<{ trip: TripSummary }>('/api/admin/trips', {
        method: 'POST',
        body: JSON.stringify({
          title: createForm.title.trim(),
          slug: createForm.slug.trim(),
          destination: createForm.destination.trim() || undefined,
          startsAt: startsAt || undefined,
          dueAt,
          defaultCostCents,
          allowPartialPayments: createForm.allowPartialPayments,
          isPublished: createForm.isPublished
        })
      });
      await loadTrips(false);
      setSelectedTripId(response.trip.id);
      setCreateForm({
        title: '',
        slug: '',
        destination: '',
        startsAt: '',
        dueAt: '',
        defaultCostDollars: '0',
        allowPartialPayments: false,
        isPublished: false
      });
      setNotice('Trip created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trip');
    }
  }

  async function handleSaveTripEdits(event: FormEvent) {
    event.preventDefault();
    if (!selectedTripId) return;
    setError(null);
    setNotice(null);
    const defaultCostCents = Math.round(Number.parseFloat(editForm.defaultCostDollars || '0') * 100);
    const startsAt = fromDatetimeLocal(editForm.startsAt);
    const dueAt = fromDatetimeLocal(editForm.dueAt);
    if (!dueAt) {
      setError('Due date is required.');
      return;
    }

    try {
      await adminFetch<{ trip: TripSummary }>(`/api/admin/trips/${encodeURIComponent(selectedTripId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title.trim(),
          slug: editForm.slug.trim(),
          destination: editForm.destination.trim() || null,
          startsAt,
          dueAt,
          defaultCostCents,
          allowPartialPayments: editForm.allowPartialPayments,
          isPublished: editForm.isPublished,
          isArchived: editForm.isArchived
        })
      });
      await loadTrips();
      await loadTripData(selectedTripId);
      setNotice('Trip updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trip');
    }
  }

  async function handlePublishOrArchive(action: 'publish' | 'archive') {
    if (!selectedTripId) return;
    setError(null);
    setNotice(null);
    try {
      await adminFetch<{ trip: TripSummary }>(`/api/admin/trips/${encodeURIComponent(selectedTripId)}/${action}`, {
        method: 'POST'
      });
      await loadTrips();
      await loadTripData(selectedTripId);
      setNotice(action === 'publish' ? 'Trip published.' : 'Trip archived.');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} trip`);
    }
  }

  async function handleDeleteTrip() {
    if (!selectedTripId || !selectedTrip) return;
    setError(null);
    setNotice(null);

    const confirmed = window.confirm(
      `Delete trip "${selectedTrip.title}" permanently?\n\nThis will permanently delete the trip, roster enrollments, trip payment records, and trip documents. This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const result = await adminFetch<{
        deleted: boolean;
        tripId: string;
        deletedEnrollments: number;
        deletedPayments: number;
        deletedDocuments: number;
      }>(`/api/admin/trips/${encodeURIComponent(selectedTripId)}`, {
        method: 'DELETE'
      });

      await loadTrips(false);
      setSelectedTrip(null);
      setRoster([]);
      setLedgerSummary(null);
      setLedgerPayments([]);
      setNotice(
        `Trip deleted. Removed ${result.deletedEnrollments} enrollments, ${result.deletedPayments} payments, and ${result.deletedDocuments} documents.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete trip');
    }
  }

  async function handleUploadDocument(event: FormEvent) {
    event.preventDefault();
    if (!selectedTripId || !documentFile) return;
    setError(null);
    setNotice(null);

    try {
      const uploaded = await uploadAdminPdf(documentFile, {
        scope: `trips/${selectedTripId}`,
        filenameBase: documentTitle.trim() || 'trip-document'
      });

      await adminFetch(`/api/admin/trips/${encodeURIComponent(selectedTripId)}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          title: documentTitle.trim() || documentFile.name.replace(/\.pdf$/i, ''),
          fileUrl: uploaded.url,
          fileKey: uploaded.key,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.size
        })
      });

      setDocumentTitle('');
      setDocumentFile(null);
      await loadTripData(selectedTripId);
      setNotice('Document uploaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    }
  }

  async function handleDeleteDocument(documentId: string) {
    if (!selectedTripId) return;
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/api/admin/trips/${encodeURIComponent(selectedTripId)}/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE'
      });
      await loadTripData(selectedTripId);
      setNotice('Document deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    }
  }

  async function handleManualRosterEntry(event: FormEvent) {
    event.preventDefault();
    if (!selectedTripId) return;
    setError(null);
    setNotice(null);
    const targetAmountCents = manualTargetDollars.trim()
      ? Math.round(Number.parseFloat(manualTargetDollars.trim()) * 100)
      : undefined;
    const dueAtOverride = fromDatetimeLocal(manualDueAt);

    try {
      await adminFetch(`/api/admin/trips/${encodeURIComponent(selectedTripId)}/roster`, {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            {
              name: manualStudentName.trim(),
              grade: manualStudentGrade.trim() || undefined,
              targetAmountCents,
              dueAtOverride: dueAtOverride || undefined
            }
          ]
        })
      });
      setManualStudentName('');
      setManualStudentGrade('');
      setManualTargetDollars('');
      setManualDueAt('');
      await loadTripData(selectedTripId);
      setNotice('Roster updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add roster entry');
    }
  }

  async function handleCsvImport(event: FormEvent) {
    event.preventDefault();
    if (!selectedTripId) return;
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/api/admin/trips/${encodeURIComponent(selectedTripId)}/roster/import`, {
        method: 'POST',
        body: JSON.stringify({ csvText })
      });
      setCsvText('');
      await loadTripData(selectedTripId);
      setNotice('Roster CSV imported.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    }
  }

  async function handleOverrideSave(row: RosterRow) {
    setError(null);
    setNotice(null);
    const targetDraft = overrideTargetByEnrollmentId[row.id] || '';
    const dueDraft = overrideDueAtByEnrollmentId[row.id] || '';
    const targetAmountCents = targetDraft.trim() ? Math.round(Number.parseFloat(targetDraft.trim()) * 100) : undefined;
    const dueAtOverride = fromDatetimeLocal(dueDraft);

    try {
      await adminFetch(`/api/admin/trips/enrollments/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          targetAmountCents,
          dueAtOverride,
          reason: 'Admin enrollment override'
        })
      });
      if (selectedTripId) {
        await loadTripData(selectedTripId);
      }
      setNotice('Enrollment override saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save override');
    }
  }

  async function handleLedgerExport() {
    if (!selectedTripId || !selectedTripSummary) return;
    const token = getAdminToken();
    if (!token) {
      setError('Admin session expired. Please log in again.');
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/admin/trips/${encodeURIComponent(selectedTripId)}/ledger/export`), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const body = (await response.text()) || `Request failed (${response.status})`;
        throw new Error(body);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `trip-ledger-${selectedTripSummary.slug}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export ledger');
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-stone-900">Trip Payments</h1>
        <p className="text-sm text-stone-600">Create trips, import roster, upload PDFs, and monitor payment progress.</p>
      </header>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold text-stone-900">Create Trip</h2>
        <form onSubmit={handleCreateTrip} className="grid gap-3 md:grid-cols-4">
          <input
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            placeholder="Title"
            value={createForm.title}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
          <input
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            placeholder="slug"
            value={createForm.slug}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, slug: event.target.value.toLowerCase() }))}
            required
          />
          <input
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            placeholder="Destination"
            value={createForm.destination}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, destination: event.target.value }))}
          />
          <input
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            type="number"
            step="0.01"
            min="0"
            placeholder="Default cost (USD)"
            value={createForm.defaultCostDollars}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, defaultCostDollars: event.target.value }))}
            required
          />
          <input
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            type="datetime-local"
            value={createForm.startsAt}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, startsAt: event.target.value }))}
          />
          <input
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            type="datetime-local"
            value={createForm.dueAt}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, dueAt: event.target.value }))}
            required
          />
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={createForm.allowPartialPayments}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, allowPartialPayments: event.target.checked }))}
            />
            Allow partial payments
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={createForm.isPublished}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, isPublished: event.target.checked }))}
            />
            Publish now
          </label>
          <div className="md:col-span-4">
            <button className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">Create Trip</button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-stone-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-stone-900">Trips</h2>
          {loading && trips.length === 0 ? <p className="text-sm text-stone-500">Loading…</p> : null}
          <div className="space-y-2">
            {trips.map((trip) => (
              <button
                key={trip.id}
                onClick={() => setSelectedTripId(trip.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  selectedTripId === trip.id
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-200 bg-white text-stone-800 hover:border-stone-400'
                }`}
              >
                <div className="font-medium">{trip.title}</div>
                <div className={`text-xs ${selectedTripId === trip.id ? 'text-stone-200' : 'text-stone-500'}`}>
                  Due {new Date(trip.dueAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="space-y-4">
          {!selectedTrip ? (
            <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500">Select a trip to manage.</div>
          ) : (
            <>
              <section className="rounded-xl border border-stone-200 bg-white p-4">
                <h2 className="mb-3 text-base font-semibold text-stone-900">Trip Settings</h2>
                <form onSubmit={handleSaveTripEdits} className="grid gap-3 md:grid-cols-4">
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    value={editForm.title}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                    required
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    value={editForm.slug}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, slug: event.target.value.toLowerCase() }))}
                    required
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    value={editForm.destination}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, destination: event.target.value }))}
                    placeholder="Destination"
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.defaultCostDollars}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, defaultCostDollars: event.target.value }))}
                    required
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    type="datetime-local"
                    value={editForm.startsAt}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, startsAt: event.target.value }))}
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    type="datetime-local"
                    value={editForm.dueAt}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, dueAt: event.target.value }))}
                    required
                  />
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={editForm.allowPartialPayments}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, allowPartialPayments: event.target.checked }))}
                    />
                    Allow partial payments
                  </label>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={editForm.isPublished}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, isPublished: event.target.checked }))}
                    />
                    Published
                  </label>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={editForm.isArchived}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, isArchived: event.target.checked }))}
                    />
                    Archived
                  </label>
                  <div className="md:col-span-4 flex flex-wrap gap-2">
                    <button className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">Save</button>
                    <button
                      type="button"
                      className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700"
                      onClick={() => void handlePublishOrArchive('publish')}
                    >
                      Publish
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700"
                      onClick={() => void handlePublishOrArchive('archive')}
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
                      onClick={() => void handleDeleteTrip()}
                    >
                      Delete Trip
                    </button>
                  </div>
                </form>
              </section>

              <section className="rounded-xl border border-stone-200 bg-white p-4">
                <h2 className="mb-3 text-base font-semibold text-stone-900">Trip Documents (PDF)</h2>
                <form onSubmit={handleUploadDocument} className="grid gap-3 md:grid-cols-3">
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    placeholder="Document title"
                    value={documentTitle}
                    onChange={(event) => setDocumentTitle(event.target.value)}
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] || null)}
                  />
                  <button className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">Upload PDF</button>
                </form>
                <div className="mt-3 space-y-2">
                  {selectedTrip.documents.length === 0 ? <p className="text-sm text-stone-500">No documents uploaded.</p> : null}
                  {selectedTrip.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2">
                      <a className="text-sm text-stone-800 hover:underline" href={doc.fileUrl} target="_blank" rel="noreferrer">
                        {doc.title}
                      </a>
                      <button className="text-sm text-red-700 hover:underline" onClick={() => void handleDeleteDocument(doc.id)}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-stone-200 bg-white p-4">
                <h2 className="mb-3 text-base font-semibold text-stone-900">Roster</h2>
                <form onSubmit={handleManualRosterEntry} className="grid gap-3 md:grid-cols-5">
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    placeholder="Student name"
                    value={manualStudentName}
                    onChange={(event) => setManualStudentName(event.target.value)}
                    required
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    placeholder="Grade"
                    value={manualStudentGrade}
                    onChange={(event) => setManualStudentGrade(event.target.value)}
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    placeholder="Target USD"
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualTargetDollars}
                    onChange={(event) => setManualTargetDollars(event.target.value)}
                  />
                  <input
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                    type="datetime-local"
                    value={manualDueAt}
                    onChange={(event) => setManualDueAt(event.target.value)}
                  />
                  <button className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">Add/Update</button>
                </form>

                <form onSubmit={handleCsvImport} className="mt-4 space-y-2">
                  <textarea
                    className="min-h-24 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                    placeholder="CSV: name,grade,targetAmountCents,dueAtOverride"
                    value={csvText}
                    onChange={(event) => setCsvText(event.target.value)}
                  />
                  <button className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700">Import CSV</button>
                </form>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 text-left text-stone-600">
                        <th className="px-2 py-2">Student</th>
                        <th className="px-2 py-2">Target</th>
                        <th className="px-2 py-2">Paid</th>
                        <th className="px-2 py-2">Remaining</th>
                        <th className="px-2 py-2">Due Override</th>
                        <th className="px-2 py-2">Claimed Account</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((row) => (
                        <tr key={row.id} className="border-b border-stone-100">
                          <td className="px-2 py-2">
                            {row.student.name}
                            {row.student.grade ? <span className="ml-1 text-stone-500">({row.student.grade})</span> : null}
                          </td>
                          <td className="px-2 py-2">
                            <input
                              className="w-28 rounded border border-stone-300 px-2 py-1"
                              value={overrideTargetByEnrollmentId[row.id] || ''}
                              onChange={(event) =>
                                setOverrideTargetByEnrollmentId((prev) => ({ ...prev, [row.id]: event.target.value }))
                              }
                            />
                          </td>
                          <td className="px-2 py-2">{formatMoney(row.paidAmountCents)}</td>
                          <td className="px-2 py-2">{formatMoney(row.remainingAmountCents)}</td>
                          <td className="px-2 py-2">
                            <input
                              type="datetime-local"
                              className="rounded border border-stone-300 px-2 py-1"
                              value={overrideDueAtByEnrollmentId[row.id] || ''}
                              onChange={(event) =>
                                setOverrideDueAtByEnrollmentId((prev) => ({ ...prev, [row.id]: event.target.value }))
                              }
                            />
                          </td>
                          <td className="px-2 py-2">{row.claimedByAccount?.email || 'Unclaimed'}</td>
                          <td className="px-2 py-2">
                            <button
                              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700"
                              onClick={() => void handleOverrideSave(row)}
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-stone-900">Ledger</h2>
                  <button
                    className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700"
                    onClick={() => void handleLedgerExport()}
                  >
                    Export CSV
                  </button>
                </div>
                {ledgerSummary ? (
                  <div className="mb-3 grid gap-2 md:grid-cols-4 text-sm">
                    <div className="rounded border border-stone-200 px-3 py-2">Target: {formatMoney(ledgerSummary.targetAmountCents)}</div>
                    <div className="rounded border border-stone-200 px-3 py-2">Collected: {formatMoney(ledgerSummary.collectedAmountCents)}</div>
                    <div className="rounded border border-stone-200 px-3 py-2">Pending: {formatMoney(ledgerSummary.pendingAmountCents)}</div>
                    <div className="rounded border border-stone-200 px-3 py-2">Remaining: {formatMoney(ledgerSummary.remainingAmountCents)}</div>
                  </div>
                ) : null}
                <div className="max-h-72 overflow-y-auto rounded border border-stone-200">
                  {ledgerPayments.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-stone-500">No payments yet.</div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-left text-stone-600">
                          <th className="px-2 py-2">Student</th>
                          <th className="px-2 py-2">Account</th>
                          <th className="px-2 py-2">Amount</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Paid At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerPayments.map((payment) => (
                          <tr key={payment.id} className="border-b border-stone-100">
                            <td className="px-2 py-2">{payment.studentName}</td>
                            <td className="px-2 py-2">{payment.accountEmail}</td>
                            <td className="px-2 py-2">{formatMoney(payment.amountCents)}</td>
                            <td className="px-2 py-2">{payment.status}</td>
                            <td className="px-2 py-2">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
