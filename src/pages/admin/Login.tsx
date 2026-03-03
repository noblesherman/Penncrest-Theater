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
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white border border-stone-200 rounded-3xl shadow-sm p-8">
        <h1 className="text-3xl font-black text-stone-900 mb-2">Admin Login</h1>
        <p className="text-stone-500 text-sm mb-6">Sign in to manage performances, orders, and seat inventory.</p>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          className="w-full border border-stone-300 rounded-xl px-4 py-3 mb-3"
          required
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          placeholder="Password"
          className="w-full border border-stone-300 rounded-xl px-4 py-3 mb-4"
          required
        />
        {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
        <button type="submit" disabled={loading} className="w-full bg-stone-900 text-white rounded-xl py-3 font-bold disabled:opacity-60">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
