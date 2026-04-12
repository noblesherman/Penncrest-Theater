import { FormEvent, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type AdminUser = {
  id: string;
  email: string;
  name: string;
  authProvider: 'GOOGLE' | 'MICROSOFT' | 'LOCAL';
  verifiedStaff: boolean;
  staffVerifyMethod: 'OAUTH_GOOGLE' | 'OAUTH_MICROSOFT' | 'REDEEM_CODE' | null;
  staffVerifiedAt: string | null;
  createdAt: string;
};

type RedeemCodeRow = {
  id: string;
  createdByAdminId: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  usedByUser: {
    id: string;
    email: string;
    name: string;
  } | null;
};

type RedemptionRow = {
  id: string;
  redeemedAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    staffVerifyMethod: string | null;
    verifiedStaff: boolean;
  };
  performance: {
    id: string;
    title: string;
    startsAt: string;
  };
  ticket: {
    id: string;
    publicId: string;
    status: string;
    orderId: string;
    seat: {
      sectionName: string;
      row: string;
      number: number;
    };
  };
};

type TeacherPromoCodeRow = {
  id: string;
  code: string | null;
  createdByAdminId: string;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
  isExpired: boolean;
};

export default function AdminStaffCompsPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [codes, setCodes] = useState<RedeemCodeRow[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [teacherPromoCodes, setTeacherPromoCodes] = useState<TeacherPromoCodeRow[]>([]);

  const [teacherPromoCodeInput, setTeacherPromoCodeInput] = useState('');
  const [teacherPromoCodeExpiresAt, setTeacherPromoCodeExpiresAt] = useState('');
  const [createdTeacherPromoCode, setCreatedTeacherPromoCode] = useState<{ id: string; code: string; expiresAt: string | null } | null>(null);
  const [copiedPromoCodeId, setCopiedPromoCodeId] = useState<string | null>(null);
  const [promoCodeStatus, setPromoCodeStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [userRows, codeRows, redemptionRows, teacherPromoCodeRows] = await Promise.all([
        adminFetch<AdminUser[]>('/api/admin/staff/users?verified=true&limit=200'),
        adminFetch<{ rows: RedeemCodeRow[] }>('/api/admin/staff/redeem-codes?status=active&page=1&pageSize=50'),
        adminFetch<{ rows: RedemptionRow[] }>(`/api/admin/staff/redemptions?page=1&pageSize=100&scope=${scope}`),
        adminFetch<{ rows: TeacherPromoCodeRow[] }>(
          `/api/admin/staff/teacher-comp-promo-codes?status=${promoCodeStatus}&page=1&pageSize=100`
        )
      ]);

      setUsers(userRows);
      setCodes(codeRows.rows);
      setRedemptions(redemptionRows.rows);
      setTeacherPromoCodes(teacherPromoCodeRows.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff comp data');
    }
  };

  useEffect(() => {
    void load();
  }, [scope, promoCodeStatus]);

  const createTeacherPromoCode = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const result = await adminFetch<{ promoCode: { id: string; code: string; expiresAt: string | null } }>(
        '/api/admin/staff/teacher-comp-promo-codes',
        {
          method: 'POST',
          body: JSON.stringify({
            code: teacherPromoCodeInput,
            expiresAt: teacherPromoCodeExpiresAt ? new Date(teacherPromoCodeExpiresAt).toISOString() : null
          })
        }
      );

      setCreatedTeacherPromoCode(result.promoCode);
      setTeacherPromoCodeInput('');
      setTeacherPromoCodeExpiresAt('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create teacher promo code');
    }
  };

  const revokeTeacherPromoCode = async (codeId: string) => {
    setError(null);

    try {
      await adminFetch(`/api/admin/staff/teacher-comp-promo-codes/${codeId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke teacher promo code');
    }
  };

  const revokeUser = async (userId: string) => {
    setError(null);

    try {
      await adminFetch(`/api/admin/staff/users/${userId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke user');
    }
  };

  const copyTextWithFallback = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-1000px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (!copied) {
      throw new Error('Copy failed');
    }
  };

  const copyTeacherPromoCode = async (codeId: string, codeValue: string | null) => {
    if (!codeValue) {
      setError('This promo code was created before code display support and cannot be copied.');
      return;
    }

    setError(null);
    try {
      await copyTextWithFallback(codeValue);
      setCopiedPromoCodeId(codeId);
      window.setTimeout(() => {
        setCopiedPromoCodeId((current) => (current === codeId ? null : current));
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy promo code');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Staff Verification & Comps</h1>
        <p className="text-sm text-stone-600">Manage redeem codes, verified staff users, and comp redemptions.</p>
        <div className="mt-2">
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as 'active' | 'archived' | 'all')}
            className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm sm:w-auto"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <section className="border border-stone-200 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold text-stone-900">Teacher Comp Promo Codes</h2>
            <p className="text-xs text-stone-500 mt-1">Teachers must enter one of these codes after OAuth to complete teacher comp checkout.</p>
          </div>
          <select
            value={promoCodeStatus}
            onChange={(event) => setPromoCodeStatus(event.target.value as 'active' | 'inactive' | 'all')}
            className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm sm:w-auto"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>

        <form onSubmit={createTeacherPromoCode} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-stone-500 font-semibold">Code</label>
            <input
              value={teacherPromoCodeInput}
              onChange={(event) => setTeacherPromoCodeInput(event.target.value)}
              placeholder="SPRING-TEACHER-2026"
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="text-xs text-stone-500 font-semibold">Expires At (optional)</label>
            <input
              type="datetime-local"
              value={teacherPromoCodeExpiresAt}
              onChange={(event) => setTeacherPromoCodeExpiresAt(event.target.value)}
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
            />
          </div>
          <button className="w-full rounded-xl bg-stone-900 px-4 py-2 font-bold text-white md:w-auto">Create Promo Code</button>
        </form>

        {createdTeacherPromoCode && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-900">
            New promo code:{' '}
            <button
              type="button"
              className="font-mono font-bold underline decoration-green-400 underline-offset-2"
              onClick={() => void copyTeacherPromoCode(createdTeacherPromoCode.id, createdTeacherPromoCode.code)}
            >
              {createdTeacherPromoCode.code}
            </button>
            {createdTeacherPromoCode.expiresAt ? ` (expires ${new Date(createdTeacherPromoCode.expiresAt).toLocaleString()})` : ''}
          </div>
        )}

        <div className="space-y-2 max-h-56 overflow-auto">
          {teacherPromoCodes.map((code) => (
            <div key={code.id} className="border border-stone-200 rounded-xl p-3 text-xs text-stone-600 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <button
                  type="button"
                  onClick={() => void copyTeacherPromoCode(code.id, code.code)}
                  disabled={!code.code}
                  className={`mb-1 inline-flex rounded-md border px-2 py-1 font-mono text-[13px] ${
                    code.code
                      ? 'border-stone-300 bg-stone-50 text-stone-900 hover:bg-stone-100'
                      : 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-500'
                  }`}
                  title={code.code ? 'Click to copy code' : 'Code not available for this legacy record'}
                >
                  {code.code || 'CODE_UNAVAILABLE'}
                </button>
                <div className="mb-1 text-[11px] text-stone-500">
                  {code.code ? (copiedPromoCodeId === code.id ? 'Copied' : 'Click code to copy') : 'Legacy entry (copy unavailable)'}
                </div>
                <div>ID: {code.id}</div>
                <div>Created: {new Date(code.createdAt).toLocaleString()}</div>
                <div>Created by: {code.createdByAdminId}</div>
                <div>
                  Expires: {code.expiresAt ? new Date(code.expiresAt).toLocaleString() : 'Never'}
                  {code.isExpired ? ' (expired)' : ''}
                </div>
                <div>Status: {code.active && !code.isExpired ? 'Active' : 'Inactive'}</div>
              </div>
              {code.active && !code.isExpired ? (
                <button
                  className="w-full rounded-md border border-red-300 px-3 py-1 text-sm text-red-600 sm:w-auto"
                  onClick={() => revokeTeacherPromoCode(code.id)}
                >
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
          {teacherPromoCodes.length === 0 && <div className="text-sm text-stone-500">No teacher promo codes found.</div>}
        </div>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Verified Staff Users</h2>
        <div className="space-y-2 max-h-64 overflow-auto">
          {users.map((user) => (
            <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-stone-900">{user.name}</div>
                <div className="text-xs text-stone-500">{user.email}</div>
                <div className="text-xs text-stone-500">
                  {user.staffVerifyMethod || 'Unknown'}
                  {user.staffVerifiedAt ? ` • ${new Date(user.staffVerifiedAt).toLocaleString()}` : ''}
                </div>
              </div>
              <button
                className="w-full rounded-md border border-red-300 px-3 py-1 text-sm text-red-600 sm:w-auto"
                onClick={() => revokeUser(user.id)}
              >
                Revoke
              </button>
            </div>
          ))}
          {users.length === 0 && <div className="text-sm text-stone-500">No verified staff users found.</div>}
        </div>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Recent Staff Comp Redemptions</h2>
        <div className="space-y-2 max-h-72 overflow-auto">
          {redemptions.map((item) => (
            <div key={item.id} className="border border-stone-200 rounded-xl p-3">
              <div className="font-semibold text-stone-900">{item.user.name} ({item.user.email})</div>
              <div className="text-xs text-stone-500">
                {item.performance.title} • {new Date(item.performance.startsAt).toLocaleString()}
              </div>
              <div className="text-xs text-stone-500">
                Seat {item.ticket.seat.sectionName} {item.ticket.seat.row}-{item.ticket.seat.number} • Ticket {item.ticket.publicId}
              </div>
              <div className="text-xs text-stone-500">Redeemed {new Date(item.redeemedAt).toLocaleString()}</div>
            </div>
          ))}
          {redemptions.length === 0 && <div className="text-sm text-stone-500">No staff comp redemptions yet.</div>}
        </div>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Active Redeem Codes</h2>
        <div className="space-y-2 max-h-56 overflow-auto">
          {codes.map((code) => (
            <div key={code.id} className="border border-stone-200 rounded-xl p-3 text-xs text-stone-600">
              <div>Code ID: {code.id}</div>
              <div>Created: {new Date(code.createdAt).toLocaleString()}</div>
              <div>Expires: {new Date(code.expiresAt).toLocaleString()}</div>
              <div>Created by: {code.createdByAdminId}</div>
            </div>
          ))}
          {codes.length === 0 && <div className="text-sm text-stone-500">No active codes.</div>}
        </div>
      </section>

      {error && <div className="text-sm text-red-600">{error}</div>}
    </div>
  );
}
