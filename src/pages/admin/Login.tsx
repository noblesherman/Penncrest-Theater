import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { setAdminToken } from '../../lib/adminAuth';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await apiFetch<{ token: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      setAdminToken(result.token);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 px-4 py-10 relative overflow-hidden" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-4xl items-center gap-8 lg:grid-cols-[1fr_420px]">
        <section>
          <div className="mb-4 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            Penncrest Theater
          </div>
          <h1 className="text-4xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Admin Portal</h1>
          <p className="mt-3 max-w-md text-sm text-stone-600">
            Manage performances, orders, seats, and check-ins from one place.
          </p>
        </section>

        <form onSubmit={submit} className="rounded-2xl border border-stone-100 bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Sign In</h2>
          <p className="mb-5 mt-1 text-sm text-stone-600">Use your admin credentials.</p>

          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Username</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            className="mb-4 w-full rounded-xl border border-stone-300 px-4 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
            required
          />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Password</label>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="Password"
            className="mb-4 w-full rounded-xl border border-stone-300 px-4 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
            required
          />

          {error ? <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-red-700 py-3 font-semibold text-white hover:bg-red-800 transition-colors disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Enter Admin'}
          </button>
        </form>
      </div>
    </div>
  );
}
