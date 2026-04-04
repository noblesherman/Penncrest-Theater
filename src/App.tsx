import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import CurtainIntro from './components/CurtainIntro';
import Layout from './components/Layout';
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
const ProgramBioFormPage = lazy(() => import('./pages/ProgramBioForm'));
const SeniorSendoffFormPage = lazy(() => import('./pages/SeniorSendoffForm'));
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
const AdminFormsPage = lazy(() => import('./pages/admin/Forms'));
const AdminAuditLogPage = lazy(() => import('./pages/admin/AuditLog'));
const AdminStaffCompsPage = lazy(() => import('./pages/admin/StaffComps'));
const AdminStudentCreditsPage = lazy(() => import('./pages/admin/StudentCredits'));
const AdminUsersPage = lazy(() => import('./pages/admin/Users'));
const AdminAboutControlPage = lazy(() => import('./pages/admin/AboutControl'));
const AdminFundraisePage = lazy(() => import('./pages/admin/Fundraise'));
const AdminTripsPage = lazy(() => import('./pages/admin/Trips'));
const TripPaymentsPage = lazy(() => import('./pages/TripPayments'));

function PublicLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function RouteTransitionOutlet() {
  const location = useLocation();

  return (
    <div key={location.pathname} className="route-transition">
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <CurtainIntro logoSrc="/favicon.svg">
      <div>
        <Router>
          <RouteSeo />
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-stone-500">Loading...</div>}>
            <Routes>
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route path="/booking/:performanceId" element={<Booking />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route path="scanner/live" element={<AdminScannerLivePage />} />
                <Route element={<RouteTransitionOutlet />}>
                  <Route index element={<Navigate to="/admin/dashboard" replace />} />
                  <Route path="dashboard" element={<AdminDashboardPage />} />
                  <Route path="finance" element={<AdminFinancePage />} />
                  <Route path="performances" element={<AdminPerformancesPage />} />
                  <Route path="archive" element={<AdminArchivePage />} />
                  <Route path="seats" element={<AdminSeatsPage />} />
                  <Route path="orders" element={<AdminOrdersPage />} />
                  <Route path="scanner" element={<AdminScannerPage />} />
                  <Route path="orders/:id" element={<AdminOrderDetailPage />} />
                  <Route path="roster" element={<AdminRosterPage />} />
                  <Route path="forms" element={<AdminFormsPage />} />
                  <Route path="staff-comps" element={<AdminStaffCompsPage />} />
                  <Route path="student-credits" element={<AdminStudentCreditsPage />} />
                  <Route path="audit" element={<AdminAuditLogPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="about" element={<AdminAboutControlPage />} />
                  <Route path="fundraise" element={<AdminFundraisePage />} />
                  <Route path="trips" element={<AdminTripsPage />} />
                </Route>
              </Route>

              <Route path="/" element={<PublicLayout />}>
                <Route element={<RouteTransitionOutlet />}>
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
                  <Route path="trip-payments" element={<TripPaymentsPage />} />
                  <Route path="forms/senior-sendoff/:slug" element={<SeniorSendoffFormPage />} />
                  <Route path="forms/:slug" element={<ProgramBioFormPage />} />
                  <Route path="privacy-policy" element={<PrivacyPolicy />} />
                  <Route path="terms-of-service" element={<TermsOfService />} />
                  <Route path="refund-policy" element={<RefundPolicy />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </Router>
      </div>
    </CurtainIntro>
  );
}
