import {
  Archive,
  Armchair,
  CalendarClock,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  ScanLine,
  ScrollText,
  Ticket,
  UserCheck,
  UsersRound
} from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearAdminToken } from '../../lib/adminAuth';
import { useAdminGuard } from './useAdminGuard';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/admin/scanner', label: 'Scanner', icon: ScanLine }
    ]
  },
  {
    title: 'Ticketing',
    items: [
      { to: '/admin/performances', label: 'Performances', icon: CalendarClock },
      { to: '/admin/seats', label: 'Seats', icon: Armchair },
      { to: '/admin/orders', label: 'Orders', icon: ReceiptText },
      { to: '/admin/archive', label: 'Archive', icon: Archive }
    ]
  },
  {
    title: 'People',
    items: [
      { to: '/admin/roster', label: 'Roster', icon: UsersRound },
      { to: '/admin/staff-comps', label: 'Staff Comps', icon: UserCheck },
      { to: '/admin/student-credits', label: 'Student Credits', icon: GraduationCap }
    ]
  },
  {
    title: 'System',
    items: [{ to: '/admin/audit', label: 'Audit Log', icon: ScrollText }]
  }
];

const allNavItems = navSections.flatMap((section) => section.items);

function isLinkActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  return pathname.startsWith(`${to}/`);
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading } = useAdminGuard();

  const pathname = location.pathname;
  const isScannerLive = pathname === '/admin/scanner/live' || pathname.startsWith('/admin/scanner/live/');

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-stone-100 text-stone-600">Loading admin session...</div>;
  }

  if (isScannerLive) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-100 bg-white relative">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6 md:py-4">
          <Link to="/admin/dashboard" className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-700 bg-red-700 text-white">
              <Ticket className="h-4 w-4" />
            </span>
            <span className="truncate text-base font-bold tracking-tight md:text-lg" style={{ fontFamily: 'Georgia, serif' }}>Theater Admin</span>
          </Link>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
            <Link
              to="/admin/scanner/live"
              className="flex-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700 hover:bg-red-100 sm:flex-none"
            >
              Full-Screen Scanner
            </Link>
            <button
              onClick={() => {
                clearAdminToken();
                navigate('/admin/login', { replace: true });
              }}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 sm:flex-none"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log Out
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 pb-3 md:hidden md:px-6">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {allNavItems.map((item) => {
              const Icon = item.icon;
              const active = isLinkActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    active ? 'border-red-700 bg-red-700 text-white' : 'border-stone-300 bg-white text-stone-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-3 py-4 sm:px-4 md:grid-cols-[240px_1fr] md:gap-6 md:px-6 md:py-6">
        <aside className="hidden rounded-2xl border border-stone-100 bg-white p-3 md:block">
          <div className="space-y-4">
            {navSections.map((section) => (
              <div key={section.title}>
                <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{section.title}</div>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isLinkActive(pathname, item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                          active ? 'bg-red-700 text-white' : 'text-stone-600 hover:bg-red-50 hover:text-red-700'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="rounded-2xl border border-stone-100 bg-white">
          <div className="p-4 sm:p-5 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
