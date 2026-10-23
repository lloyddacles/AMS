import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Students from './pages/Students.jsx';
import QrSheet from './pages/QrSheet.jsx';
import Events from './pages/Events.jsx';
import EventDetail from './pages/EventDetail.jsx';
import PrintSheet from './pages/PrintSheet.jsx';
import Schedules from './pages/Schedules.jsx';
import Terms from './pages/Terms.jsx';
import Scanner from './pages/Scanner.jsx';
import Live from './pages/Live.jsx';
import Reports from './pages/Reports.jsx';
import PublicCheckin from './pages/PublicCheckin.jsx';
import Corrections from './pages/Corrections.jsx';
import CorrectionsReview from './pages/CorrectionsReview.jsx';
import About from './pages/About.jsx';
import Profile from './pages/Profile.jsx';
import Users from './pages/Users.jsx';
import AuditLog from './pages/AuditLog.jsx';
import MustChangePassword from './pages/MustChangePassword.jsx';
import Backup from './pages/Backup.jsx';
import { useStudent } from './studentAuth.jsx';
import StudentLogin from './pages/portal/StudentLogin.jsx';
import PortalLayout from './pages/portal/PortalLayout.jsx';
import PortalDashboard from './pages/portal/PortalDashboard.jsx';
import PortalHistory from './pages/portal/PortalHistory.jsx';
import PortalCorrections from './pages/portal/PortalCorrections.jsx';
import PortalAccount from './pages/portal/PortalAccount.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.mustChangePassword) return <MustChangePassword />;
  return <Layout>{children}</Layout>;
}

function StudentProtected({ children }) {
  const { student, loading } = useStudent();
  if (loading) return <LoadingScreen />;
  if (!student) return <Navigate to="/portal/login" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/checkin/:code" element={<PublicCheckin />} />
      <Route path="/corrections" element={<Corrections />} />
      <Route path="/corrections/review" element={<Protected><CorrectionsReview /></Protected>} />
      <Route path="/portal/login" element={<StudentLogin />} />
      <Route
        path="/portal"
        element={
          <StudentProtected>
            <PortalLayout />
          </StudentProtected>
        }
      >
        <Route index element={<PortalDashboard />} />
        <Route path="history" element={<PortalHistory />} />
        <Route path="corrections" element={<PortalCorrections />} />
        <Route path="account" element={<PortalAccount />} />
      </Route>
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/students" element={<Protected><Students /></Protected>} />
      <Route path="/students/qr-sheet" element={<Protected><QrSheet /></Protected>} />
      <Route path="/live" element={<Protected><Live /></Protected>} />
      <Route path="/events" element={<Protected><Events /></Protected>} />
      <Route path="/events/:id" element={<Protected><EventDetail /></Protected>} />
      <Route path="/events/:id/print-sheet" element={<Protected><PrintSheet /></Protected>} />
      <Route path="/events/:id/scan" element={<Protected><Scanner /></Protected>} />
      <Route path="/schedules" element={<Protected><Schedules /></Protected>} />
      <Route path="/terms" element={<Protected><AdminOnly><Terms /></AdminOnly></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/about" element={<Protected><About /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/users" element={<Protected><AdminOnly><Users /></AdminOnly></Protected>} />
      <Route path="/audit" element={<Protected><AdminOnly><AuditLog /></AdminOnly></Protected>} />
      <Route path="/backup" element={<Protected><AdminOnly><Backup /></AdminOnly></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
