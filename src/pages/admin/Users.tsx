/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/Users.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { type ReactNode, useEffect, useState } from 'react';
import { adminFetch, formatAdminRole, type AdminRole } from '../../lib/adminAuth';

type AdminUserRow = {
  id: string;
  username: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateForm = {
  username: string;
  name: string;
  password: string;
  role: AdminRole;
};

type DraftRow = {
  username: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  password: string;
};

const ROLE_LABELS: Record<string, string> = {
  BOX_OFFICE:  'Box Office',
  ADMIN:       'Admin',
  SUPER_ADMIN: 'Super Admin',
};

const ROLE_BADGE: Record<string, string> = {
  BOX_OFFICE:  'bg-sky-50 text-sky-700 ring-sky-200',
  ADMIN:       'bg-violet-50 text-violet-700 ring-violet-200',
  SUPER_ADMIN: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100 placeholder:text-stone-400';

const selectCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100 cursor-pointer';

function Badge({ label, style }: { label: string; style?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${style ?? 'bg-stone-100 text-stone-500 ring-stone-200'}`}>
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-stone-400">
      {children}
    </p>
  );
}

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({
    username: '',
    name: '',
    password: '',
    role: 'BOX_OFFICE',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const users = await adminFetch<AdminUserRow[]>('/api/admin/users');
      setRows(users);
      setDrafts(
        Object.fromEntries(
          users.map((u) => [u.id, { username: u.username, name: u.name, role: u.role, isActive: u.isActive, password: '' }])
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load admin users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateDraft = (id: string, patch: Partial<DraftRow>) =>
    setDrafts((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  const createUser = async () => {
    setCreating(true); setError(null); setNotice(null);
    try {
      await adminFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(createForm) });
      setCreateForm({ username: '', name: '', password: '', role: 'BOX_OFFICE' });
      setNotice('Admin user created successfully.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to create admin user');
    } finally { setCreating(false); }
  };

  const saveUser = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id); setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ username: draft.username, name: draft.name, role: draft.role, isActive: draft.isActive }),
      });
      setNotice('User updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to update admin user');
    } finally { setBusyId(null); }
  };

  const resetPassword = async (id: string) => {
    const draft = drafts[id];
    if (!draft?.password.trim()) { setError('Enter a new password before resetting.'); return; }
    setBusyId(id); setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: draft.password }) });
      updateDraft(id, { password: '' });
      setNotice('Password reset successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to reset password');
    } finally { setBusyId(null); }
  };

  const resetTwoFactor = async (id: string) => {
    setBusyId(id); setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/users/${id}/reset-2fa`, { method: 'POST' });
      setNotice('Two-factor authentication turned off.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to reset 2FA');
    } finally { setBusyId(null); }
  };

  const toggleTwoFactor = async (user: AdminUserRow, nextEnabled: boolean) => {
    if (user.role === 'BOX_OFFICE') return;
    if (user.twoFactorEnabled === nextEnabled) return;
    setBusyId(user.id); setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ twoFactorEnabled: nextEnabled }),
      });
      setNotice(
        nextEnabled
          ? 'Two-factor authentication turned on. The user will set it up on next login.'
          : 'Two-factor authentication turned off.'
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to update 2FA');
    } finally { setBusyId(null); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">

      {/* ── Header ── */}
      <div>
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Admin</p>
        <h1
          className="text-3xl font-bold text-stone-900"
          style={{ fontFamily: "var(--font-sans)", letterSpacing: '-0.02em' }}
        >
          Manage Users
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Create and manage box office, admin, and super admin accounts.
        </p>
      </div>

      {/* ── Alerts ── */}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {notice}
        </div>
      )}

      {/* ── Create User ── */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <SectionLabel>Create User</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={createForm.name}
            onChange={(e) => setCreateForm((c) => ({ ...c, name: e.target.value }))}
            placeholder="Full name"
            className={inputCls}
          />
          <input
            value={createForm.username}
            onChange={(e) => setCreateForm((c) => ({ ...c, username: e.target.value }))}
            placeholder="Username"
            className={inputCls}
          />
          <input
            value={createForm.password}
            onChange={(e) => setCreateForm((c) => ({ ...c, password: e.target.value }))}
            type="password"
            placeholder="Temporary password"
            className={inputCls}
          />
          <select
            value={createForm.role}
            onChange={(e) => setCreateForm((c) => ({ ...c, role: e.target.value as AdminRole }))}
            className={selectCls}
          >
            {Object.entries(ROLE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          <button
            onClick={() => { void createUser(); }}
            disabled={creating}
            className="w-full rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>

      {/* ── Current Users ── */}
      <div>
        <SectionLabel>Current Users</SectionLabel>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-stone-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading users…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="py-6 text-center text-sm text-stone-400">No admin users found.</p>
        )}

        <div className="space-y-3">
          {rows.map((user) => {
            const draft = drafts[user.id];
            if (!draft) return null;
            const isBusy = busyId === user.id;
            const twoFactorLabel =
              user.role === 'BOX_OFFICE'
                ? '2FA Off (Role)'
                : user.twoFactorEnabled
                  ? '2FA On'
                  : '2FA Off';
            const twoFactorStyle =
              user.role === 'BOX_OFFICE'
                ? 'bg-stone-100 text-stone-600 ring-stone-200'
                : user.twoFactorEnabled
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-amber-50 text-amber-700 ring-amber-200';

            return (
              <div key={user.id} className="rounded-2xl border border-stone-100 bg-white shadow-sm">
                {/* User summary */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">{user.name}</p>
                    <p className="mt-0.5 text-xs text-stone-400">{user.username}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      label={ROLE_LABELS[user.role] ?? user.role}
                      style={ROLE_BADGE[user.role]}
                    />
                    <Badge
                      label={user.isActive ? 'Active' : 'Inactive'}
                      style={user.isActive
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-stone-100 text-stone-500 ring-stone-200'}
                    />
                    <Badge
                      label={twoFactorLabel}
                      style={twoFactorStyle}
                    />
                    <span className="text-xs text-stone-400">
                      {user.lastLoginAt
                        ? `Last login ${new Date(user.lastLoginAt).toLocaleDateString()}`
                        : 'Never logged in'}
                    </span>
                  </div>
                </div>

                {/* Edit fields */}
                <div className="px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={draft.name}
                      onChange={(e) => updateDraft(user.id, { name: e.target.value })}
                      placeholder="Full name"
                      className={inputCls}
                    />
                    <input
                      value={draft.username}
                      onChange={(e) => updateDraft(user.id, { username: e.target.value })}
                      placeholder="Username"
                      className={inputCls}
                    />
                    <select
                      value={draft.role}
                      onChange={(e) => updateDraft(user.id, { role: e.target.value as AdminRole })}
                      className={selectCls}
                    >
                      {Object.entries(ROLE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 select-none">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(e) => updateDraft(user.id, { isActive: e.target.checked })}
                        className="h-4 w-4 rounded border-stone-300 accent-stone-700"
                      />
                      Active account
                    </label>
                    {user.role !== 'BOX_OFFICE' && (
                      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 select-none">
                        <input
                          type="checkbox"
                          checked={user.twoFactorEnabled}
                          onChange={(e) => { void toggleTwoFactor(user, e.target.checked); }}
                          disabled={isBusy}
                          className="h-4 w-4 rounded border-stone-300 accent-amber-600 disabled:cursor-not-allowed disabled:opacity-70"
                        />
                        2FA enabled
                      </label>
                    )}
                    <input
                      value={draft.password}
                      onChange={(e) => updateDraft(user.id, { password: e.target.value })}
                      type="password"
                      placeholder="New password (to reset)"
                      className={inputCls}
                    />
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => { void saveUser(user.id); }}
                      disabled={isBusy}
                      className="w-full rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      {isBusy ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => { void resetPassword(user.id); }}
                      disabled={isBusy}
                      className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      Reset Password
                    </button>
                    {user.role !== 'BOX_OFFICE' && (
                      <button
                        onClick={() => { void resetTwoFactor(user.id); }}
                        disabled={isBusy}
                        className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      >
                        Reset 2FA
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
