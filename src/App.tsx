import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import LionSplash from './components/LionSplash';
import RouteSeo from './components/RouteSeo';
import Home from './pages/Home';

const Shows = lazy(() => import('./pages/Shows'));
const CommunityEvents = lazy(() => import('./pages/CommunityEvents'));
const ShowDetails = lazy(() => import('./pages/ShowDetails'));
const About = lazy(() => import('./pages/About'));
const TechCrew = lazy(() => import('./pages/TechCrew'));
const SetDesign = lazy(() => import('./pages/SetDesign'));
const MusicalTheater = lazy(() => import('./pages/MusicalTheater'));
const InterestMeeting = lazy(() => import('./pages/InterestMeeting'));
const Fundraising = lazy(() => import('./pages/Fundraising'));
const FundraisingEventDetail = lazy(() => import('./pages/FundraisingEventDetail'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const RefundPolicy = lazy(() => import('./pages/RefundPolicy'));
const Booking = lazy(() => import('./pages/Booking'));
const Confirmation = lazy(() => import('./pages/Confirmation'));
const OrderLookup = lazy(() => import('./pages/OrderLookup'));
const TicketPage = lazy(() => import('./pages/Ticket'));
const StaffTicketsPage = lazy(() => import('./pages/StaffTickets'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminLoginPage = lazy(() => import('./pages/admin/Login'));
const AdminDashboardPage = lazy(() => import('./pages/admin/Dashboard'));
const AdminFinancePage = lazy(() => import('./pages/admin/Finance'));
const AdminPerformancesPage = lazy(() => import('./pages/admin/Performances'));
const AdminArchivePage = lazy(() => import('./pages/admin/Archive'));
const AdminSeatsPage = lazy(() => import('./pages/admin/Seats'));
const AdminOrdersPage = lazy(() => import('./pages/admin/Orders'));
const AdminScannerPage = lazy(() => import('./pages/admin/Scanner'));
const AdminScannerLivePage = lazy(() => import('./pages/admin/ScannerLive'));
const AdminOrderDetailPage = lazy(() => import('./pages/admin/OrderDetail'));
const AdminRosterPage = lazy(() => import('./pages/admin/Roster'));
const AdminAuditLogPage = lazy(() => import('./pages/admin/AuditLog'));
const AdminStaffCompsPage = lazy(() => import('./pages/admin/StaffComps'));
const AdminStudentCreditsPage = lazy(() => import('./pages/admin/StudentCredits'));
const AdminUsersPage = lazy(() => import('./pages/admin/Users'));
const AdminAboutControlPage = lazy(() => import('./pages/admin/AboutControl'));
const AdminFundraisePage = lazy(() => import('./pages/admin/Fundraise'));

const SPLASH_SEEN_STORAGE_KEY = 'theater_lion_intro_seen_v1';
const SPLASH_MIN_DURATION_MS = 950;
const SPLASH_FADE_DURATION_MS = 450;
const SPLASH_MAX_WAIT_MS = 2400;

function useInitialLionSplash() {
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      return sessionStorage.getItem(SPLASH_SEEN_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [splashIsFading, setSplashIsFading] = useState(false);

  useEffect(() => {
    if (!showSplash || typeof window === 'undefined') {
      return;
    }

    const startedAt = performance.now();
    let isDisposed = false;
    let hasCompleted = false;
    const timerIds: number[] = [];

    const clearTimers = () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
      timerIds.length = 0;
    };

    const completeSplash = () => {
      if (isDisposed || hasCompleted) {
        return;
      }
      hasCompleted = true;

      const elapsedMs = performance.now() - startedAt;
      const waitMs = Math.max(0, SPLASH_MIN_DURATION_MS - elapsedMs);

      timerIds.push(
        window.setTimeout(() => {
          if (isDisposed) {
            return;
          }
          setSplashIsFading(true);

          timerIds.push(
            window.setTimeout(() => {
              if (isDisposed) {
                return;
              }
              setShowSplash(false);
              setSplashIsFading(false);
              try {
                sessionStorage.setItem(SPLASH_SEEN_STORAGE_KEY, '1');
              } catch {
                // Ignore storage errors and allow the intro next load.
              }
            }, SPLASH_FADE_DURATION_MS)
          );
        }, waitMs)
      );
    };

    const onWindowLoad = () => completeSplash();

    if (document.readyState === 'complete') {
      completeSplash();
    } else {
      window.addEventListener('load', onWindowLoad, { once: true });
    }

    timerIds.push(window.setTimeout(completeSplash, SPLASH_MAX_WAIT_MS));

    return () => {
      isDisposed = true;
      window.removeEventListener('load', onWindowLoad);
      clearTimers();
    };
  }, [showSplash]);

  return { showSplash, splashIsFading };
}

function PublicLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function App() {
  const { showSplash, splashIsFading } = useInitialLionSplash();
  const appIsVisible = !showSplash || splashIsFading;

  return (
    <>
      <div className={`app-boot${appIsVisible ? ' app-boot--ready' : ''}`}>
        <Router>
          <RouteSeo />
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-stone-500">Loading...</div>}>
            <Routes>
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route path="/booking/:performanceId" element={<Booking />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route path="finance" element={<AdminFinancePage />} />
                <Route path="performances" element={<AdminPerformancesPage />} />
                <Route path="archive" element={<AdminArchivePage />} />
                <Route path="seats" element={<AdminSeatsPage />} />
                <Route path="orders" element={<AdminOrdersPage />} />
                <Route path="scanner" element={<AdminScannerPage />} />
                <Route path="scanner/live" element={<AdminScannerLivePage />} />
                <Route path="orders/:id" element={<AdminOrderDetailPage />} />
                <Route path="roster" element={<AdminRosterPage />} />
                <Route path="staff-comps" element={<AdminStaffCompsPage />} />
                <Route path="student-credits" element={<AdminStudentCreditsPage />} />
                <Route path="audit" element={<AdminAuditLogPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="about" element={<AdminAboutControlPage />} />
                <Route path="fundraise" element={<AdminFundraisePage />} />
              </Route>

              <Route path="/" element={<PublicLayout />}>
                <Route index element={<Home />} />
                <Route path="shows" element={<Shows />} />
                <Route path="shows/community-events" element={<CommunityEvents />} />
                <Route path="shows/:id" element={<ShowDetails />} />
                <Route path="confirmation" element={<Confirmation />} />
                <Route path="orders/lookup" element={<OrderLookup />} />
                <Route path="tickets/:publicId" element={<TicketPage />} />
                <Route path="teacher-tickets" element={<StaffTicketsPage />} />
                <Route path="staff-tickets" element={<StaffTicketsPage />} />
                <Route path="about" element={<About />} />
                <Route path="tech-crew" element={<TechCrew />} />
                <Route path="set-design" element={<SetDesign />} />
                <Route path="musical-theater" element={<MusicalTheater />} />
                <Route path="interest-meeting" element={<InterestMeeting />} />
                <Route path="fundraising" element={<Fundraising />} />
                <Route path="fundraising/events/:slug" element={<FundraisingEventDetail />} />
                <Route path="privacy-policy" element={<PrivacyPolicy />} />
                <Route path="terms-of-service" element={<TermsOfService />} />
                <Route path="refund-policy" element={<RefundPolicy />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </Router>
      </div>

      {showSplash ? <LionSplash fading={splashIsFading} /> : null}
    </>
  );
}
