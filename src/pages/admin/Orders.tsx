import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { adminFetch } from '../../lib/adminAuth';
import {
  Search, X, Check, ChevronRight, ChevronLeft,
  User, Mail, Hash, Ticket, DollarSign, Plus,
  ExternalLink, AlertCircle, CheckCircle2
} from 'lucide-react';

// ── types ────────────────────────────────────────────────────────────────────

type Order = {
  id: string; status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE' | 'STUDENT_COMP';
  email: string; customerName: string;
  amountTotal: number; createdAt: string;
  performanceTitle: string; ticketCount: number;
};

type Performance = { id: string; title: string; startsAt: string };

type AssignForm = {
  performanceId: string; source: 'DOOR' | 'COMP';
  customerName: string; customerEmail: string;
  seatIdsInput: string; ticketType: string;
  priceCents: number; sendEmail: boolean;
};

// ── helpers ──────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-300 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition';
const sel = inp + ' cursor-pointer';

const STATUS_COLORS: Record<string, string> = {
  PAID:      'bg-green-50 text-green-700 border-green-200',
  PENDING:   'bg-amber-50 text-amber-700 border-amber-200',
  REFUNDED:  'bg-stone-100 text-stone-500 border-stone-200',
  CANCELED:  'bg-red-50 text-red-600 border-red-200',
};

const SOURCE_COLORS: Record<string, string> = {
  ONLINE:       'bg-blue-50 text-blue-700 border-blue-200',
  DOOR:         'bg-purple-50 text-purple-700 border-purple-200',
  COMP:         'bg-stone-100 text-stone-600 border-stone-200',
  STAFF_FREE:   'bg-amber-50 text-amber-700 border-amber-200',
  FAMILY_FREE:  'bg-pink-50 text-pink-700 border-pink-200',
  STUDENT_COMP: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

function Chip({ label, colorCls }: { label: string; colorCls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colorCls}`}>
      {label}
    </span>
  );
}

const WIZARD_STEPS = [
  { id: 'show',     label: 'Show',     icon: Ticket    },
  { id: 'customer', label: 'Customer', icon: User      },
  { id: 'seats',    label: 'Seats',    icon: Hash      },
];

// ── main ─────────────────────────────────────────────────────────────────────

export default function AdminOrdersPage() {
  const [rows,         setRows]         = useState<Order[]>([]);
  const [query,        setQuery]        = useState('');
  const [status,       setStatus]       = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [scope,        setScope]        = useState<'active' | 'archived' | 'all'>('active');
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [loadingRows,  setLoadingRows]  = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [notice,       setNotice]       = useState<string | null>(null);
  const [showWizard,   setShowWizard]   = useState(false);
  const [step,         setStep]         = useState(0);
  const [dir,          setDir]          = useState<1 | -1>(1);

  const [assignForm, setAssignForm] = useState<AssignForm>({
    performanceId: '', source: 'DOOR',
    customerName: '', customerEmail: '',
    seatIdsInput: '', ticketType: '',
    priceCents: 1800, sendEmail: false,
  });

  // ── data loading ───────────────────────────────────────────────────────────

  const load = async () => {
    setLoadingRows(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (sourceFilter) params.set('source', sourceFilter);
      params.set('scope', scope);
      setRows(await adminFetch<Order[]>(`/api/admin/orders?${params.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load orders'); }
    finally { setLoadingRows(false); }
  };

  const loadPerformances = async () => {
    try {
      const items = await adminFetch<Array<{ id: string; title: string; startsAt: string; isArchived?: boolean }>>('/api/admin/performances?scope=active');
      const mapped = items.filter(i => !i.isArchived).map(i => ({ id: i.id, title: i.title, startsAt: i.startsAt }));
      setPerformances(mapped);
      if (mapped.length > 0)
        setAssignForm(prev => ({ ...prev, performanceId: mapped.some(r => r.id === prev.performanceId) ? prev.performanceId : mapped[0].id }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load performances'); }
  };

  useEffect(() => { void Promise.all([load(), loadPerformances()]); }, []);
  useEffect(() => { void load(); }, [scope]);

  const search = (e: FormEvent) => { e.preventDefault(); void load(); };

  // ── assign ─────────────────────────────────────────────────────────────────

  const assignOrder = async () => {
    setError(null); setNotice(null);
    const seatIds = assignForm.seatIdsInput.split(',').map(v => v.trim()).filter(Boolean);
    if (!assignForm.performanceId || seatIds.length === 0) { setError('Choose a performance and provide at least one seat ID.'); return; }

    const ticketTypeBySeatId = Object.fromEntries(seatIds.map(id => [id, assignForm.ticketType || (assignForm.source === 'COMP' ? 'Comp' : 'Door')]));
    const priceBySeatId      = Object.fromEntries(seatIds.map(id => [id, assignForm.source === 'COMP' ? 0 : assignForm.priceCents]));

    setSubmitting(true);
    try {
      await adminFetch('/api/admin/orders/assign', {
        method: 'POST',
        body: JSON.stringify({ performanceId: assignForm.performanceId, seatIds, customerName: assignForm.customerName, customerEmail: assignForm.customerEmail, ticketTypeBySeatId, priceBySeatId, source: assignForm.source, sendEmail: assignForm.sendEmail }),
      });
      setAssignForm(prev => ({ ...prev, customerName: '', customerEmail: '', seatIdsInput: '' }));
      setNotice(`Assigned ${seatIds.length} seat${seatIds.length === 1 ? '' : 's'} successfully.`);
      closeWizard();
      void load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to assign seats'); }
    finally { setSubmitting(false); }
  };

  // ── wizard ─────────────────────────────────────────────────────────────────

  const goTo = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); setError(null); };
  const closeWizard = () => { setShowWizard(false); setStep(0); setError(null); };

  const seatIds = assignForm.seatIdsInput.split(',').map(v => v.trim()).filter(Boolean);

  const wizardSteps = [

    // STEP 0 — SHOW
    <div key="show" className="space-y-4">
      <p className="text-sm text-stone-400">Which performance are you assigning seats for?</p>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Performance</label>
        <select value={assignForm.performanceId} onChange={e => setAssignForm({ ...assignForm, performanceId: e.target.value })} className={sel}>
          {performances.map(p => (
            <option key={p.id} value={p.id}>{p.title} — {new Date(p.startsAt).toLocaleDateString()}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Type</label>
        <div className="grid grid-cols-2 gap-3">
          {(['DOOR', 'COMP'] as const).map(src => (
            <button key={src} type="button" onClick={() => setAssignForm({ ...assignForm, source: src })}
              className={`rounded-xl border-2 py-4 text-sm font-bold transition-all ${assignForm.source === src ? 'border-red-700 bg-red-50 text-red-700' : 'border-stone-200 text-stone-400 hover:border-stone-300'}`}>
              {src === 'DOOR' ? '🚪 Door Sale' : '🎟️ Comp'}
            </button>
          ))}
        </div>
      </div>
      {assignForm.source === 'DOOR' && (
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Price <span className="normal-case font-normal text-stone-300">(cents)</span></label>
          <input type="number" min={0} value={assignForm.priceCents}
            onChange={e => setAssignForm({ ...assignForm, priceCents: Math.max(0, Number(e.target.value) || 0) })}
            className={inp + ' w-36'} />
          <p className="text-xs text-stone-300 mt-1">= ${(assignForm.priceCents / 100).toFixed(2)}</p>
        </div>
      )}
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Ticket label <span className="normal-case font-normal text-stone-300">(optional)</span></label>
        <input value={assignForm.ticketType} onChange={e => setAssignForm({ ...assignForm, ticketType: e.target.value })}
          placeholder="e.g. Adult, Student…" className={inp} />
      </div>
    </div>,

    // STEP 1 — CUSTOMER
    <div key="customer" className="space-y-4">
      <p className="text-sm text-stone-400">Who is receiving these tickets?</p>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Name</label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-300 pointer-events-none" />
          <input value={assignForm.customerName} onChange={e => setAssignForm({ ...assignForm, customerName: e.target.value })}
            placeholder="Full name" required className={inp + ' pl-10'} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Email</label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-300 pointer-events-none" />
          <input type="email" value={assignForm.customerEmail} onChange={e => setAssignForm({ ...assignForm, customerEmail: e.target.value })}
            placeholder="email@example.com" required className={inp + ' pl-10'} />
        </div>
      </div>
      <label className="flex items-center gap-3 cursor-pointer group">
        <button type="button" onClick={() => setAssignForm({ ...assignForm, sendEmail: !assignForm.sendEmail })}
          className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative focus:outline-none ${assignForm.sendEmail ? 'bg-red-700' : 'bg-stone-200'}`}>
          <motion.div layout className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${assignForm.sendEmail ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
        <span className="text-sm text-stone-700 group-hover:text-stone-900 transition">Email tickets immediately</span>
      </label>
    </div>,

    // STEP 2 — SEATS + CONFIRM
    <div key="seats" className="space-y-4">
      <p className="text-sm text-stone-400">Enter the seat IDs to assign.</p>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Seat IDs <span className="normal-case font-normal text-stone-300">(comma-separated)</span></label>
        <input value={assignForm.seatIdsInput} onChange={e => setAssignForm({ ...assignForm, seatIdsInput: e.target.value })}
          placeholder="A1, A2, B3…" className={inp} />
        {seatIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {seatIds.map(id => (
              <span key={id} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-mono font-semibold text-stone-600">{id}</span>
            ))}
          </div>
        )}
      </div>

      {/* summary */}
      {assignForm.performanceId && (
        <div className="rounded-2xl border border-stone-100 divide-y divide-stone-100 overflow-hidden bg-white">
          {[
            { label: 'Performance', value: performances.find(p => p.id === assignForm.performanceId)?.title ?? '—' },
            { label: 'Type',        value: assignForm.source },
            { label: 'Customer',    value: assignForm.customerName || <span className="text-stone-300">—</span> },
            { label: 'Email',       value: assignForm.customerEmail || <span className="text-stone-300">—</span> },
            { label: 'Seats',       value: seatIds.length > 0 ? `${seatIds.length} seat(s)` : <span className="text-red-400 font-semibold">None yet</span> },
            { label: 'Total',       value: assignForm.source === 'COMP' ? 'Free' : `$${((assignForm.priceCents * seatIds.length) / 100).toFixed(2)}` },
            { label: 'Send email',  value: assignForm.sendEmail ? '✓ Yes' : 'No' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-stone-400">{label}</span>
              <span className="text-stone-800 font-semibold text-right max-w-[55%] truncate">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>,
  ];

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-6" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Orders</h1>
          <p className="text-sm text-stone-400 mt-0.5">Search and manage ticket orders.</p>
        </div>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => { setShowWizard(true); setStep(0); setError(null); }}
          className="flex items-center gap-2 bg-red-700 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-red-800 transition shadow-sm shadow-red-100">
          <Plus className="w-4 h-4" /> Assign Seats
        </motion.button>
      </div>

      {/* notices */}
      <AnimatePresence>
        {notice && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />{notice}
            <button onClick={() => setNotice(null)} className="ml-auto text-green-400 hover:text-green-700"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
        {error && !showWizard && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-700"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── assign wizard modal ── */}
      <AnimatePresence>
        {showWizard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 16 }}
              animate={{ scale: 1,    opacity: 1, y: 0  }}
              exit={{    scale: 0.93, opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
              style={{ maxHeight: '90vh' }}
            >
              {/* header */}
              <div className="px-6 pt-5 pb-4 border-b border-stone-100 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Assign Seats</p>
                  <button onClick={closeWizard} className="text-stone-300 hover:text-stone-600 transition rounded-full p-1 hover:bg-stone-50"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex items-center gap-2">
                  {WIZARD_STEPS.map((s, i) => {
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
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={step}
                    initial={{ x: dir * 32, opacity: 0 }}
                    animate={{ x: 0,        opacity: 1 }}
                    exit={{    x: dir * -32, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {wizardSteps[step]}
                  </motion.div>
                </AnimatePresence>

                <AnimatePresence>
                  {error && showWizard && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* footer */}
              <div className="px-6 py-4 border-t border-stone-100 bg-stone-50/60 flex items-center justify-between flex-shrink-0">
                <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0}
                  className="flex items-center gap-1 text-sm font-semibold text-stone-400 hover:text-stone-800 disabled:opacity-25 disabled:cursor-not-allowed transition">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <span className="text-xs text-stone-300">{step + 1} / {WIZARD_STEPS.length}</span>
                {step < WIZARD_STEPS.length - 1
                  ? <button type="button" onClick={() => goTo(step + 1)}
                      className="flex items-center gap-1.5 bg-stone-900 text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-stone-800 transition">
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  : <motion.button type="button" onClick={assignOrder} disabled={submitting}
                      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-1.5 bg-red-700 text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-800 disabled:opacity-60 transition shadow-sm shadow-red-100">
                      <Check className="w-4 h-4" /> {submitting ? 'Assigning…' : 'Assign'}
                    </motion.button>
                }
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── search bar ── */}
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-0" style={{ minWidth: 200 }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-300 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, or order ID…"
            className="w-full rounded-xl border border-stone-200 pl-10 pr-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition bg-white">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="REFUNDED">Refunded</option>
          <option value="CANCELED">Canceled</option>
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition bg-white">
          <option value="">All sources</option>
          <option value="ONLINE">Online</option>
          <option value="DOOR">Door</option>
          <option value="COMP">Comp</option>
          <option value="STAFF_FREE">Staff Free</option>
          <option value="FAMILY_FREE">Family Free</option>
          <option value="STUDENT_COMP">Student Comp</option>
        </select>
        <select value={scope} onChange={e => setScope(e.target.value as 'active' | 'archived' | 'all')}
          className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition bg-white">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button className="flex items-center gap-1.5 bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-800 transition">
          <Search className="w-3.5 h-3.5" /> Search
        </button>
      </form>

      {/* ── results ── */}
      {loadingRows
        ? <div className="text-sm text-stone-400 py-4 text-center">Loading orders…</div>
        : rows.length === 0
          ? <div className="rounded-2xl border border-dashed border-stone-200 py-12 text-center text-sm text-stone-300">No orders found.</div>
          : (
            <div className="space-y-2">
              {rows.map((order, idx) => (
                <motion.div key={order.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="rounded-2xl border border-stone-100 bg-white p-4 flex items-start justify-between gap-4 hover:shadow-sm hover:border-stone-200 transition-all"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-stone-900 text-sm font-mono truncate">{order.id}</p>
                      <Chip label={order.status} colorCls={STATUS_COLORS[order.status] ?? 'bg-stone-100 text-stone-500 border-stone-200'} />
                      <Chip label={order.source} colorCls={SOURCE_COLORS[order.source] ?? 'bg-stone-100 text-stone-500 border-stone-200'} />
                    </div>
                    <p className="text-sm text-stone-700 font-medium">{order.customerName}</p>
                    <p className="text-xs text-stone-400">{order.email}</p>
                    <p className="text-xs text-stone-400">{order.performanceTitle} · {new Date(order.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex-shrink-0 text-right space-y-2">
                    <p className="font-bold text-stone-900">${(order.amountTotal / 100).toFixed(2)}</p>
                    <p className="text-xs text-stone-400">{order.ticketCount} ticket{order.ticketCount !== 1 ? 's' : ''}</p>
                    <Link to={`/admin/orders/${order.id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-900 transition">
                      View <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          )
      }
    </div>
  );
}