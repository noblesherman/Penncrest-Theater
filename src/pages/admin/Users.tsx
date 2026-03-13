import { useEffect, useState } from 'react';
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

const inputClassName =
  'w-full rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100';

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
    role: 'BOX_OFFICE'
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const users = await adminFetch<AdminUserRow[]>('/api/admin/users');
      setRows(users);
      setDrafts(
        Object.fromEntries(
          users.map((user) => [
            user.id,
            {
              username: user.username,
              name: user.name,
              role: user.role,
              isActive: user.isActive,
              password: ''
            }
          ])
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch
      }
    }));
  };

  const createUser = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      await adminFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(createForm)
      });
      setCreateForm({
        username: '',
        name: '',
        password: '',
        role: 'BOX_OFFICE'
      });
      setNotice('Admin user created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create admin user');
    } finally {
      setCreating(false);
    }
  };

  const saveUser = async (id: string) => {
    const draft = drafts[id];
    if (!draft) {
      return;
    }

    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          username: draft.username,
          name: draft.name,
          role: draft.role,
          isActive: draft.isActive
        })
      });
      setNotice('User updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update admin user');
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (id: string) => {
    const draft = drafts[id];
    if (!draft?.password.trim()) {
      setError('Enter a new password before resetting it.');
      return;
    }

    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({
          password: draft.password
        })
      });
      updateDraft(id, { password: '' });
      setNotice('Password reset.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setBusyId(null);
    }
  };

  const resetTwoFactor = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/users/${id}/reset-2fa`, {
        method: 'POST'
      });
      setNotice('Two-factor authentication reset. The user will be prompted to set it up again on next login.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset two-factor authentication');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div>
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Manage Users</h1>
        <p className="mt-1 text-sm text-stone-600">Create box office, admin, and super admin accounts from one place.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div> : null}

      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <h2 className="text-lg font-semibold text-stone-900">Create User</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input
            value={createForm.name}
            onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Full name"
            className={inputClassName}
          />
          <input
            value={createForm.username}
            onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))}
            placeholder="Username"
            className={inputClassName}
          />
          <input
            value={createForm.password}
            onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
            type="password"
            placeholder="Temporary password"
            className={inputClassName}
          />
          <select
            value={createForm.role}
            onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value as AdminRole }))}
            className={inputClassName}
          >
            <option value="BOX_OFFICE">Box Office</option>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            void createUser();
          }}
          disabled={creating}
          className="mt-4 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
        >
          {creating ? 'Creating...' : 'Create User'}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-stone-900">Current Users</h2>
        {loading ? <div className="text-sm text-stone-500">Loading users...</div> : null}
        {!loading && rows.length === 0 ? <div className="text-sm text-stone-500">No admin users found.</div> : null}
        {rows.map((user) => {
          const draft = drafts[user.id];
          if (!draft) {
            return null;
          }

          return (
            <div key={user.id} className="rounded-2xl border border-stone-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-stone-900">{user.name}</div>
                  <div className="text-xs text-stone-500">
                    {user.username} · {formatAdminRole(user.role)} · {user.isActive ? 'Active' : 'Inactive'} · {user.twoFactorEnabled ? '2FA on' : '2FA pending'}
                  </div>
                </div>
                <div className="text-xs text-stone-500">
                  {user.lastLoginAt ? `Last login ${new Date(user.lastLoginAt).toLocaleString()}` : 'No logins yet'}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft(user.id, { name: event.target.value })}
                  className={inputClassName}
                />
                <input
                  value={draft.username}
                  onChange={(event) => updateDraft(user.id, { username: event.target.value })}
                  className={inputClassName}
                />
                <select
                  value={draft.role}
                  onChange={(event) => updateDraft(user.id, { role: event.target.value as AdminRole })}
                  className={inputClassName}
                >
                  <option value="BOX_OFFICE">Box Office</option>
                  <option value="ADMIN">Admin</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
                <label className="flex items-center gap-2 rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(event) => updateDraft(user.id, { isActive: event.target.checked })}
                  />
                  Active account
                </label>
                <input
                  value={draft.password}
                  onChange={(event) => updateDraft(user.id, { password: event.target.value })}
                  type="password"
                  placeholder="New password"
                  className={inputClassName}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void saveUser(user.id);
                  }}
                  disabled={busyId === user.id}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-60"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void resetPassword(user.id);
                  }}
                  disabled={busyId === user.id}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                >
                  Reset Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void resetTwoFactor(user.id);
                  }}
                  disabled={busyId === user.id}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                >
                  Reset 2FA
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
