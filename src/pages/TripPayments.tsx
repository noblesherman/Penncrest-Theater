import { FormEvent, useEffect, useMemo, useState } from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { 
  ArrowRight, 
  Calendar, 
  CheckCircle2, 
  Clock3, 
  CreditCard, 
  FileText, 
  PieChart, 
  TrendingUp, 
  Wallet,
  LogOut,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { clearTripToken, getTripToken, setTripToken, tripFetch } from '../lib/tripAuth';
import { apiFetch } from '../lib/api';

// --- Types (Kept from your original logic) ---
type TripAuthMe = {
  account: { id: string; email: string; name: string | null; studentId: string | null; hasClaimedStudent: boolean; };
  student: { id: string; name: string; grade: string | null; isActive: boolean; } | null;
};

type ClaimOptionsResponse = {
  account: { id: string; email: string; name: string | null; studentId: string | null; hasClaimedStudent: boolean; };
  claimedStudent: { id: string; name: string; grade: string | null; isActive?: boolean; } | null;
  claimableStudents: Array<{ id: string; name: string; grade: string | null; trips: Array<{ id: string; title: string; dueAt: string; }>; }>;
};

type DashboardResponse = {
  account: { id: string; email: string; name: string | null; studentId: string; hasClaimedStudent: true; };
  student: { id: string; name: string; grade: string | null; isActive: boolean; } | null;
  enrollments: Array<{
    enrollmentId: string; targetAmountCents: number; paidAmountCents: number; remainingAmountCents: number;
    dueAt: string; dueAtOverridden: boolean; isOverdue: boolean; canPay: boolean; allowPartialPayments: boolean;
    claimedAt: string | null;
    trip: { id: string; title: string; slug: string; destination: string | null; startsAt: string | null; dueAt: string; documents: Array<{ id: string; title: string; fileUrl: string; mimeType: string; sizeBytes: number; }>; };
  }>;
  payments: Array<{ id: string; enrollmentId: string; tripId: string; tripTitle: string; tripSlug: string; amountCents: number; currency: string; status: string; paidAt: string | null; createdAt: string; stripePaymentIntentId: string | null; }>;
};

// --- Helper Functions ---
const formatMoney = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const formatDate = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function ProgressDonut({ paidAmountCents, targetAmountCents, size = 80, stroke = 8 }: { paidAmountCents: number; targetAmountCents: number; size?: number; stroke?: number }) {
  const percent = Math.max(0, Math.min(100, Math.round((paidAmountCents / (targetAmountCents || 1)) * 100)));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-stone-100" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} strokeLinecap="round"
          className="fill-none stroke-red-600 transition-all duration-700 ease-out"
          style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
        />
      </svg>
      <span className="absolute text-sm font-bold text-stone-900">{percent}%</span>
    </div>
  );
}

export default function TripPaymentsPage() {
  // State management (Keeping your logic intact)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestCodeEmail, setRequestCodeEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authStage, setAuthStage] = useState<'request' | 'verify' | 'authenticated'>('request');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [activeEnrollmentId, setActiveEnrollmentId] = useState<string | null>(null);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [activeCheckout, setActiveCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);

  // Styling Constants
  const cardStyles = "bg-white border border-stone-200 rounded-[2rem] p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)]";
  const inputStyles = "w-full rounded-2xl border border-stone-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-600/20 transition-all";
  const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-full bg-red-700 px-6 py-3 text-sm font-bold text-white hover:bg-red-800 transition-all active:scale-95";

  // ... [Keep your existing useEffect, handleRequestCode, handleVerifyCode, startPaymentSession logic here] ...

  return (
    <main className="min-h-screen bg-[#FDFCFB] text-stone-900 selection:bg-red-100">
      {/* Header Navigation */}
      <header className="sticky top-0 z-50 border-b border-stone-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-red-700 flex items-center justify-center text-white font-bold italic">P</div>
            <span className="text-lg font-bold tracking-tight">Penncrest <span className="text-red-700 italic">Theater</span></span>
          </div>
          {authStage === 'authenticated' && (
            <button onClick={() => { clearTripToken(); setAuthStage('request'); }} className="group flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-red-700 transition-colors">
              <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              Sign Out
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* Hero Section */}
        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-red-50 px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-red-700 border border-red-100">
            <ShieldCheck className="h-3 w-3" /> Secure Trip Portal
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            Manage Your <span className="italic text-red-700 underline decoration-red-200 underline-offset-8">Adventure.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-stone-500 leading-relaxed">
            Track your funding progress, settle balances, and view trip documents in one place.
          </p>
        </div>

        {/* AUTHENTICATION VIEWS */}
        {authStage !== 'authenticated' && (
          <div className="mx-auto max-w-md">
            <div className={cardStyles}>
              <h2 className="mb-2 text-xl font-bold">{authStage === 'request' ? "Sign In" : "Check Your Email"}</h2>
              <p className="mb-6 text-sm text-stone-500">
                {authStage === 'request' ? "Enter your email to receive a secure login code." : "We've sent a 6-digit code to your inbox."}
              </p>
              
              <form className="space-y-4">
                {authStage === 'request' ? (
                  <input type="email" placeholder="email@example.com" className={inputStyles} value={requestCodeEmail} onChange={e => setRequestCodeEmail(e.target.value)} />
                ) : (
                  <input type="text" placeholder="000000" className={`${inputStyles} text-center text-2xl tracking-[0.5em] font-mono`} maxLength={6} value={verificationCode} onChange={e => setVerificationCode(e.target.value)} />
                )}
                <button type="submit" className={`${btnPrimary} w-full`}>
                  {authStage === 'request' ? "Send Code" : "Verify Identity"}
                </button>
                {authStage === 'verify' && (
                   <button type="button" onClick={() => setAuthStage('request')} className="w-full text-center text-xs font-bold text-stone-400 uppercase tracking-widest hover:text-stone-600">Back</button>
                )}
              </form>
            </div>
          </div>
        )}

        {/* DASHBOARD VIEW */}
        {authStage === 'authenticated' && dashboard && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* Student Overview Card */}
            <section className="relative overflow-hidden bg-stone-900 rounded-[2.5rem] p-8 text-white shadow-2xl">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-red-600/20 blur-[80px]" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="text-3xl font-black italic">{dashboard.student?.name}</h2>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 border border-white/5 uppercase tracking-widest">Grade {dashboard.student?.grade}</span>
                    <span className="text-stone-400 text-sm">• Active Student</span>
                  </div>
                </div>
                <div className="flex gap-4">
                   <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-1">Total Remaining</p>
                      <p className="text-3xl font-black text-red-500 italic">
                        {formatMoney(dashboard.enrollments.reduce((s, e) => s + e.remainingAmountCents, 0))}
                      </p>
                   </div>
                </div>
              </div>
            </section>

            {/* Trip Cards Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              {dashboard.enrollments.map((enrollment) => (
                <div key={enrollment.enrollmentId} className={cardStyles}>
                  <div className="mb-6 flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-bold tracking-tight text-stone-900">{enrollment.trip.title}</h3>
                      <div className="mt-1 flex items-center gap-2 text-xs font-bold text-stone-400 uppercase tracking-widest">
                        <Calendar className="h-3 w-3" /> Due {formatDate(enrollment.dueAt)}
                      </div>
                    </div>
                    <ProgressDonut paidAmountCents={enrollment.paidAmountCents} targetAmountCents={enrollment.targetAmountCents} />
                  </div>

                  <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl bg-stone-50 p-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Paid</p>
                      <p className="font-bold text-stone-900">{formatMoney(enrollment.paidAmountCents)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Total</p>
                      <p className="font-bold text-stone-900">{formatMoney(enrollment.targetAmountCents)}</p>
                    </div>
                  </div>

                  {enrollment.canPay ? (
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">$</span>
                        <input 
                          type="number" 
                          className={`${inputStyles} pl-8`} 
                          placeholder="Amount"
                          value={amountDrafts[enrollment.enrollmentId] || ''}
                          onChange={e => setAmountDrafts({...amountDrafts, [enrollment.enrollmentId]: e.target.value})}
                        />
                      </div>
                      <button className={btnPrimary}>Pay Now</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> Paid in Full
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Document Section */}
            <section className={cardStyles}>
               <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
                 <FileText className="h-5 w-5 text-red-700" /> Trip Paperwork
               </h3>
               <div className="divide-y divide-stone-100">
                 {dashboard.enrollments.flatMap(e => e.trip.documents).map(doc => (
                   <a key={doc.id} href={doc.fileUrl} className="group flex items-center justify-between py-4 hover:px-2 transition-all">
                     <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-stone-100 p-2 text-stone-500 group-hover:bg-red-50 group-hover:text-red-700 transition-colors">
                          <FileText className="h-5 w-5" />
                        </div>
                        <span className="text-sm font-medium text-stone-700">{doc.title}</span>
                     </div>
                     <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-red-700" />
                   </a>
                 ))}
               </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}