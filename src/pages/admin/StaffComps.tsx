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

export default function AdminStaffCompsPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [codes, setCodes] = useState<RedeemCodeRow[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);

  const [count, setCount] = useState(1);
  const [expiresInMinutes, setExpiresInMinutes] = useState(60 * 24 * 7);
  const [generatedCodes, setGeneratedCodes] = useState<Array<{ id: string; code: string; expiresAt: string }>>([]);
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [userRows, codeRows, redemptionRows] = await Promise.all([
        adminFetch<AdminUser[]>('/api/admin/staff/users?verified=true&limit=200'),
        adminFetch<{ rows: RedeemCodeRow[] }>('/api/admin/staff/redeem-codes?status=active&page=1&pageSize=50'),
        adminFetch<{ rows: RedemptionRow[] }>(`/api/admin/staff/redemptions?page=1&pageSize=100&scope=${scope}`)
      ]);

      setUsers(userRows);
      setCodes(codeRows.rows);
      setRedemptions(redemptionRows.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff comp data');
    }
  };

  useEffect(() => {
    void load();
  }, [scope]);

  const generateCodes = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const result = await adminFetch<{ codes: Array<{ id: string; code: string; expiresAt: string }> }>(
        '/api/admin/staff/redeem-codes',
        {
          method: 'POST',
          body: JSON.stringify({ count, expiresInMinutes })
        }
      );
      setGeneratedCodes(result.codes);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate codes');
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black text-stone-900 mb-1">Staff Verification & Comps</h1>
        <p className="text-sm text-stone-600">Manage redeem codes, verified staff users, and comp redemptions.</p>
        <div className="mt-2">
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as 'active' | 'archived' | 'all')}
            className="border border-stone-300 rounded-xl px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Generate Redeem Codes</h2>
        <form onSubmit={generateCodes} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-stone-500 font-semibold">Count</label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(event) => setCount(Math.max(1, Number(event.target.value) || 1))}
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="text-xs text-stone-500 font-semibold">Expires In (minutes)</label>
            <input
              type="number"
              min={5}
              max={60 * 24 * 30}
              value={expiresInMinutes}
              onChange={(event) => setExpiresInMinutes(Math.max(5, Number(event.target.value) || 5))}
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
            />
          </div>
          <button className="bg-stone-900 text-white px-4 py-2 rounded-xl font-bold">Generate</button>
        </form>

        {generatedCodes.length > 0 && (
          <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
            <div className="font-semibold text-stone-900 mb-2">New single-use codes</div>
            <div className="space-y-1 text-sm text-stone-700">
              {generatedCodes.map((item) => (
                <div key={item.id}>
                  <span className="font-mono font-bold">{item.code}</span>
                  <span className="text-stone-500"> (expires {new Date(item.expiresAt).toLocaleString()})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Verified Staff Users</h2>
        <div className="space-y-2 max-h-64 overflow-auto">
          {users.map((user) => (
            <div key={user.id} className="border border-stone-200 rounded-xl p-3 flex justify-between items-center gap-3">
              <div>
                <div className="font-semibold text-stone-900">{user.name}</div>
                <div className="text-xs text-stone-500">{user.email}</div>
                <div className="text-xs text-stone-500">
                  {user.staffVerifyMethod || 'Unknown'}
                  {user.staffVerifiedAt ? ` • ${new Date(user.staffVerifiedAt).toLocaleString()}` : ''}
                </div>
              </div>
              <button
                className="text-sm px-3 py-1 rounded-md border border-red-300 text-red-600"
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
