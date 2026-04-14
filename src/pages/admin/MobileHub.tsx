import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link, Navigate } from 'react-router-dom';
import {
  CalendarClock,
  CircleDollarSign,
  LayoutDashboard,
  QrCode,
  ReceiptText,
  ScanLine,
  Smartphone
} from 'lucide-react';
import type { AdminRole } from '../../lib/adminAuth';
import { hasAdminRole } from '../../lib/adminAuth';
import { useAdminSession } from './useAdminSession';

type QuickLink = {
  to: string;
  label: string;
  description: string;
  icon: typeof ScanLine;
  minRole: AdminRole;
};

const quickLinks: QuickLink[] = [
  {
    to: '/admin/orders',
    label: 'Orders',
    description: 'Search and manage tickets fast',
    icon: ReceiptText,
    minRole: 'BOX_OFFICE'
  },
  {
    to: '/admin/scanner',
    label: 'Scanner Setup',
    description: 'Pick show and prep scanning',
    icon: QrCode,
    minRole: 'BOX_OFFICE'
  },
  {
    to: '/admin/dashboard',
    label: 'Dashboard',
    description: 'Daily overview and status',
    icon: LayoutDashboard,
    minRole: 'BOX_OFFICE'
  },
  {
    to: '/admin/performances',
    label: 'Performances',
    description: 'Manage shows and dates',
    icon: CalendarClock,
    minRole: 'ADMIN'
  },
  {
    to: '/admin/finance',
    label: 'Finance',
    description: 'Track totals and payouts',
    icon: CircleDollarSign,
    minRole: 'ADMIN'
  }
];

export default function AdminMobileHubPage() {
  const { admin } = useAdminSession();
  const firstName = useMemo(() => {
    const clean = admin.name.trim();
    if (!clean) return 'there';
    return clean.split(/\s+/)[0];
  }, [admin.name]);
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const visibleLinks = useMemo(
    () => quickLinks.filter((item) => hasAdminRole(admin.role, item.minRole)),
    [admin.role]
  );

  if (!isMobile) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 pb-safe">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-stone-200 bg-white px-5 py-5 shadow-sm"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">Mobile Hub</p>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mt-1 text-[2rem] font-black leading-tight tracking-tight text-stone-900"
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          Welcome, {firstName}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mt-0.5 text-sm text-stone-500"
        >
          Jump into the tools you need most.
        </motion.p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <Link
          to="/admin/scanner/live"
          className="group block rounded-3xl border border-stone-800 bg-stone-900 p-5 text-white shadow-lg transition hover:bg-stone-800"
        >
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <ScanLine className="h-5 w-5" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">Primary Action</p>
          <p className="mt-1 text-2xl font-black leading-tight">Full Screen Scanner</p>
          <p className="mt-1 text-sm text-stone-400">Fastest way to check in tickets at the door.</p>
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm"
      >
        <div className="mb-3 flex items-center gap-2 px-1">
          <Smartphone className="h-4 w-4 text-stone-400" />
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Quick Links</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {visibleLinks.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.to}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.24 + idx * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link
                  to={item.to}
                  className="block rounded-2xl border border-stone-100 bg-stone-50 px-3 py-3 transition hover:border-stone-200 hover:bg-white"
                >
                  <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white ring-1 ring-stone-200">
                    <Icon className="h-4 w-4 text-stone-700" />
                  </div>
                  <p className="text-sm font-bold text-stone-900">{item.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-stone-500">{item.description}</p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}