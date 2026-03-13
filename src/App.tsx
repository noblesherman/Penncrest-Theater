import { BrowserRouter as Router, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Shows from './pages/Shows';
import ShowDetails from './pages/ShowDetails';
import Booking from './pages/Booking';
import Confirmation from './pages/Confirmation';
import About from './pages/About';
import TechCrew from './pages/TechCrew';
import SetDesign from './pages/SetDesign';
import MusicalTheater from './pages/MusicalTheater';
import ParentsAssociation from './pages/ParentsAssociation';
import InterestMeeting from './pages/InterestMeeting';
import OrderLookup from './pages/OrderLookup';
import TicketPage from './pages/Ticket';
import StaffTicketsPage from './pages/StaffTickets';
import FamilyTicketPage from './pages/FamilyTicket';
import AdminLayout from './pages/admin/AdminLayout';
import AdminLoginPage from './pages/admin/Login';
import AdminDashboardPage from './pages/admin/Dashboard';
import AdminPerformancesPage from './pages/admin/Performances';
import AdminArchivePage from './pages/admin/Archive';
import AdminSeatsPage from './pages/admin/Seats';
import AdminOrdersPage from './pages/admin/Orders';
import AdminScannerPage from './pages/admin/Scanner';
import AdminScannerLivePage from './pages/admin/ScannerLive';
import AdminOrderDetailPage from './pages/admin/OrderDetail';
import AdminRosterPage from './pages/admin/Roster';
import AdminAuditLogPage from './pages/admin/AuditLog';
import AdminStaffCompsPage from './pages/admin/StaffComps';
import AdminStudentCreditsPage from './pages/admin/StudentCredits';
import AdminUsersPage from './pages/admin/Users';

function PublicLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/booking/:performanceId" element={<Booking />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
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
        </Route>

        <Route path="/" element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="shows" element={<Shows />} />
          <Route path="shows/:id" element={<ShowDetails />} />
          <Route path="confirmation" element={<Confirmation />} />
          <Route path="orders/lookup" element={<OrderLookup />} />
          <Route path="tickets/:publicId" element={<TicketPage />} />
          <Route path="teacher-tickets" element={<StaffTicketsPage />} />
          <Route path="staff-tickets" element={<StaffTicketsPage />} />
          <Route path="family-ticket" element={<FamilyTicketPage />} />
          <Route path="about" element={<About />} />
          <Route path="tech-crew" element={<TechCrew />} />
          <Route path="set-design" element={<SetDesign />} />
          <Route path="musical-theater" element={<MusicalTheater />} />
          <Route path="parents-association" element={<ParentsAssociation />} />
          <Route path="interest-meeting" element={<InterestMeeting />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
