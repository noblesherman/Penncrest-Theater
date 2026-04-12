import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  Armchair,
  CalendarClock,
  CircleDollarSign,
  HandCoins,
  FilePenLine,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  ScanLine,
  ScrollText,
  ShieldCheck,
  Plane,
  FolderOpen,
  Smartphone,
  Ticket,
  UserCheck,
  UsersRound,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { AdminRole } from '../../lib/adminAuth';
import { clearAdminToken, formatAdminRole, hasAdminRole } from '../../lib/adminAuth';
import { ADMIN_GREETING_DURATION_MS, consumeAdminPostLoginGreeting } from '../../lib/adminPostLoginGreeting';
import { useAdminGuard } from './useAdminGuard';
import type { AdminLayoutContext } from './useAdminSession';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  minRole: AdminRole;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, minRole: 'BOX_OFFICE' },
      { to: '/admin/finance', label: 'Finance', icon: CircleDollarSign, minRole: 'ADMIN' },
      { to: '/admin/scanner', label: 'Scanner', icon: ScanLine, minRole: 'BOX_OFFICE' },
      { to: '/admin/orders', label: 'Orders', icon: ReceiptText, minRole: 'BOX_OFFICE' },
      { to: '/admin/devices', label: 'Devices', icon: Smartphone, minRole: 'ADMIN' }
    ]
  },
  {
    title: 'Ticketing',
    items: [
      { to: '/admin/performances', label: 'Performances', icon: CalendarClock, minRole: 'ADMIN' },
      { to: '/admin/seats', label: 'Seats', icon: Armchair, minRole: 'ADMIN' },
      { to: '/admin/archive', label: 'Archive', icon: Archive, minRole: 'ADMIN' }
    ]
  },
  {
    title: 'People',
    items: [
      { to: '/admin/roster', label: 'Roster', icon: UsersRound, minRole: 'ADMIN' },
      { to: '/admin/forms', label: 'Forms', icon: FileText, minRole: 'ADMIN' },
      { to: '/admin/staff-comps', label: 'Staff Comps', icon: UserCheck, minRole: 'ADMIN' },
      { to: '/admin/student-credits', label: 'Student Credits', icon: GraduationCap, minRole: 'ADMIN' }
    ]
  },
  {
    title: 'Admin',
    items: [
      { to: '/admin/fundraise', label: 'Fundraise', icon: HandCoins, minRole: 'ADMIN' },
      { to: '/admin/trips', label: 'Trip Payments', icon: Plane, minRole: 'ADMIN' },
      { to: '/admin/drive', label: 'Drive', icon: FolderOpen, minRole: 'ADMIN' },
      { to: '/admin/audit', label: 'Audit Log', icon: ScrollText, minRole: 'ADMIN' },
      { to: '/admin/about', label: 'About', icon: FilePenLine, minRole: 'SUPER_ADMIN' },
      { to: '/admin/users', label: 'Manage Users', icon: ShieldCheck, minRole: 'SUPER_ADMIN' }
    ]
  }
];

const routeAccessRules: Array<{ prefix: string; minRole: AdminRole }> = [
  { prefix: '/admin/users', minRole: 'SUPER_ADMIN' },
  { prefix: '/admin/finance', minRole: 'ADMIN' },
  { prefix: '/admin/performances', minRole: 'ADMIN' },
  { prefix: '/admin/seats', minRole: 'ADMIN' },
  { prefix: '/admin/archive', minRole: 'ADMIN' },
  { prefix: '/admin/roster', minRole: 'ADMIN' },
  { prefix: '/admin/forms', minRole: 'ADMIN' },
  { prefix: '/admin/staff-comps', minRole: 'ADMIN' },
  { prefix: '/admin/student-credits', minRole: 'ADMIN' },
  { prefix: '/admin/fundraise', minRole: 'ADMIN' },
  { prefix: '/admin/trips', minRole: 'ADMIN' },
  { prefix: '/admin/drive', minRole: 'ADMIN' },
  { prefix: '/admin/devices', minRole: 'ADMIN' },
  { prefix: '/admin/audit', minRole: 'ADMIN' },
  { prefix: '/admin/about', minRole: 'SUPER_ADMIN' },
  { prefix: '/admin/orders', minRole: 'BOX_OFFICE' },
  { prefix: '/admin/scanner', minRole: 'BOX_OFFICE' },
  { prefix: '/admin/dashboard', minRole: 'BOX_OFFICE' }
];

const SIDEBAR_COLLAPSED_KEY = 'admin_sidebar_collapsed';

function isLinkActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  return pathname.startsWith(`${to}/`);
}

function getPageTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last === 'admin') return 'Dashboard';
  return last
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, admin } = useAdminGuard();
  const [postLoginGreeting, setPostLoginGreeting] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  useEffect(() => {
    if (!admin) return;

    const message = consumeAdminPostLoginGreeting();
    if (!message) return;

    setPostLoginGreeting(message);
    const timer = window.setTimeout(() => {
      setPostLoginGreeting(null);
    }, ADMIN_GREETING_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [admin]);

  useEffect(() => {
    if (!postLoginGreeting) return;

    let cancelled = false;

    void import('canvas-confetti')
      .then(({ default: confetti }) => {
        if (cancelled) return;

        const base = {
          spread: 60,
          startVelocity: 24,
          gravity: 1,
          ticks: 120,
          scalar: 0.75,
          colors: ['#f43f5e', '#fb7185', '#f59e0b', '#fbbf24', '#ffffff'],
        };

        confetti({
          ...base,
          particleCount: 55,
          origin: { x: 0.5, y: 0.6 },
        });

        confetti({
          ...base,
          particleCount: 28,
          angle: 60,
          origin: { x: 0.2, y: 0.72 },
        });

        confetti({
          ...base,
          particleCount: 28,
          angle: 120,
          origin: { x: 0.8, y: 0.72 },
        });
      })
      .catch(() => {
        // Keep login flow resilient if confetti fails to load.
      });

    return () => {
      cancelled = true;
    };
  }, [postLoginGreeting]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const pathname = location.pathname;
  const isScannerLive = pathname === '/admin/scanner/live' || pathname.startsWith('/admin/scanner/live/');
  const matchedRule = routeAccessRules
    .filter((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  const visibleNavSections = admin
    ? navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => hasAdminRole(admin.role, item.minRole))
        }))
        .filter((section) => section.items.length > 0)
    : [];
  const fallbackRoute = visibleNavSections.flatMap((section) => section.items)[0]?.to || '/admin/login';
  const outletContext: AdminLayoutContext | undefined = admin ? { admin } : undefined;
  const pageTitle = getPageTitle(pathname);

  if (loading || !admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 rounded-lg bg-rose-600 flex items-center justify-center">
            <Ticket className="h-4 w-4 text-white" />
          </div>
          <p className="text-sm text-zinc-500 tracking-wide">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (matchedRule && !hasAdminRole(admin.role, matchedRule.minRole)) {
    return <Navigate to={fallbackRoute} replace />;
  }

  if (isScannerLive) {
    return <Outlet context={outletContext} />;
  }

  const initials = admin.name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="min-h-screen flex bg-[#f5f4f2] font-sans">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`
          hidden md:flex flex-col min-h-screen bg-[#111110] shrink-0 sticky top-0 h-screen overflow-hidden
          transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
          ${sidebarCollapsed ? 'w-[84px]' : 'w-[232px]'}
        `}
      >

        {/* Logo */}
        <div className={`pt-6 pb-5 border-b border-white/[0.06] ${sidebarCollapsed ? 'px-3' : 'px-5'}`}>
          <Link to="/admin/dashboard" className={`flex items-center group ${sidebarCollapsed ? 'justify-center' : 'gap-2.5'}`}>
            <div className="h-7 w-7 rounded-md bg-rose-600 flex items-center justify-center shrink-0">
              <Ticket className="h-3.5 w-3.5 text-white" />
            </div>
            <div
              className={`
                min-w-0 overflow-hidden transition-all duration-250
                ${sidebarCollapsed ? 'max-w-0 opacity-0' : 'max-w-[140px] opacity-100'}
              `}
            >
              <span className="text-white text-sm font-semibold tracking-tight leading-none block" style={{ fontFamily: "var(--font-sans)" }}>
                Penncrest Theater
              </span>
              <span className="text-zinc-500 text-[10px] tracking-widest uppercase leading-none block mt-0.5">
                Box Office
              </span>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav className={`no-scrollbar flex-1 py-4 space-y-5 overflow-y-auto ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {visibleNavSections.map((section) => (
            <div key={section.title}>
              {sidebarCollapsed ? <div className="mx-2 mb-2 h-px bg-white/[0.06]" /> : (
                <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isLinkActive(pathname, item.to);
                  return (
                    <Link
                      title={sidebarCollapsed ? item.label : undefined}
                      key={item.to}
                      to={item.to}
                      className={`
                        flex items-center rounded-md text-[13px] font-medium transition-all duration-150
                        ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2'}
                        ${active
                          ? 'bg-white/[0.08] text-white'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                        }
                      `}
                    >
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-rose-400' : 'text-zinc-600'}`} />
                      {!sidebarCollapsed ? item.label : null}
                      {active && !sidebarCollapsed ? <ChevronRight className="h-3 w-3 ml-auto text-zinc-600" /> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className={`py-4 border-t border-white/[0.06] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          <Link
            to="/admin/scanner/live"
            title={sidebarCollapsed ? 'Full-Screen Scanner' : undefined}
            className={`
              flex items-center rounded-md text-[13px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]
              transition-all mb-1 ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-2 px-2.5 py-2'}
            `}
          >
            <ScanLine className="h-3.5 w-3.5 text-zinc-600" />
            {!sidebarCollapsed ? 'Full-Screen Scanner' : null}
          </Link>

          <div className={`mt-3 flex items-center rounded-md border border-white/[0.06] ${sidebarCollapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-2'}`}>
            <div className="h-6 w-6 rounded-full bg-rose-900 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-rose-200">{initials}</span>
            </div>
            <div
              className={`
                min-w-0 flex-1 overflow-hidden transition-all duration-250
                ${sidebarCollapsed ? 'max-w-0 opacity-0' : 'max-w-[130px] opacity-100'}
              `}
            >
              <p className="text-[12px] font-medium text-zinc-300 truncate leading-none">{admin.name}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5 leading-none">{formatAdminRole(admin.role)}</p>
            </div>
            <button
              onClick={() => {
                clearAdminToken();
                navigate('/admin/login', { replace: true });
              }}
              className="text-zinc-600 hover:text-rose-400 transition-colors p-1 rounded"
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="h-14 bg-[#f5f4f2] border-b border-black/[0.06] flex items-center px-6 gap-4 sticky top-0 z-10">
          {/* Mobile logo */}
          <div className="flex md:hidden items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-rose-600 flex items-center justify-center">
              <Ticket className="h-3 w-3 text-white" />
            </div>
            <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-sans)" }}>Penncrest Theater</span>
          </div>

          {/* Page title */}
          <div className="hidden md:flex items-center gap-2 text-sm text-zinc-400">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-black/[0.08] bg-white text-zinc-600 transition-all hover:border-zinc-300 hover:text-zinc-900"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            </button>
            <span className="text-zinc-800 font-medium">{pageTitle}</span>
          </div>

          {/* Mobile nav pills */}
          <div className="no-scrollbar flex md:hidden gap-1.5 overflow-x-auto flex-1 px-1">
            {visibleNavSections.flatMap((s) => s.items).map((item) => {
              const Icon = item.icon;
              const active = isLinkActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`
                    shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all
                    ${active
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white border border-black/[0.08] text-zinc-600 hover:border-zinc-300'
                    }
                  `}
                >
                  <Icon className="h-3 w-3" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/admin/scanner/live"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-black/[0.08] text-[12px] font-semibold text-zinc-700 hover:border-zinc-300 transition-all shadow-sm"
            >
              <ScanLine className="h-3.5 w-3.5 text-rose-500" />
              Scanner
            </Link>
            <button
              onClick={() => {
                clearAdminToken();
                navigate('/admin/login', { replace: true });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-black/[0.08] text-[12px] font-semibold text-zinc-700 hover:border-zinc-300 transition-all shadow-sm"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Log Out</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-6 py-8 max-w-[1200px] w-full mx-auto">
          <Outlet context={outletContext} />
        </main>
      </div>

      <AnimatePresence>
        {postLoginGreeting && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
          >
            <motion.div
              className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(244,63,94,0.28)_0%,_rgba(15,23,42,0.88)_48%,_rgba(0,0,0,0.96)_100%)]"
              initial={{ scale: 1.06 }}
              animate={{ scale: 1 }}
              transition={{ duration: 3.4, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.div
              className="relative px-6 text-center text-white"
              initial={{ opacity: 0, y: 22, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-rose-200/80">
                Penncrest Theater
              </p>
              <h2 className="text-4xl font-black tracking-tight sm:text-6xl">
                {postLoginGreeting}
              </h2>
              <p className="mt-5 text-sm font-medium tracking-wide text-zinc-200/80">
                Welcome to the admin portal
              </p>
              <p className="mt-2 text-[11px] font-medium tracking-[0.2em] uppercase text-zinc-300/70">
                Noble is sending love
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
