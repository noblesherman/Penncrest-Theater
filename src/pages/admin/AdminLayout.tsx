import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearAdminToken } from '../../lib/adminAuth';
import { useAdminGuard } from './useAdminGuard';

const links = [
  { to: '/admin/dashboard', label: 'Dashboard' },
  { to: '/admin/performances', label: 'Performances' },
  { to: '/admin/archive', label: 'Archive' },
  { to: '/admin/seats', label: 'Seats' },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/scanner', label: 'Scanner' },
  { to: '/admin/roster', label: 'Roster' },
  { to: '/admin/staff-comps', label: 'Staff Comps' },
  { to: '/admin/student-credits', label: 'Student Credits' },
  { to: '/admin/audit', label: 'Audit Log' }
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { loading } = useAdminGuard();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading admin session...</div>;
  }

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/admin/dashboard" className="font-black text-xl text-stone-900">Theater Admin</Link>
          <button
            onClick={() => {
              clearAdminToken();
              navigate('/admin/login', { replace: true });
            }}
            className="text-sm font-bold text-red-600"
          >
            Log Out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-[220px,1fr] gap-6">
        <aside className="bg-white rounded-2xl border border-stone-200 p-3 h-fit">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm font-semibold ${isActive ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </aside>

        <main className="bg-white rounded-2xl border border-stone-200 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
