import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import { DialogProvider } from './dialogs.jsx';
import { useStudent } from './studentAuth.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Students = lazy(() => import('./pages/Students.jsx'));
const QrSheet = lazy(() => import('./pages/QrSheet.jsx'));
const Events = lazy(() => import('./pages/Events.jsx'));
const EventDetail = lazy(() => import('./pages/EventDetail.jsx'));
const PrintSheet = lazy(() => import('./pages/PrintSheet.jsx'));
const Schedules = lazy(() => import('./pages/Schedules.jsx'));
const Terms = lazy(() => import('./pages/Terms.jsx'));
const Scanner = lazy(() => import('./pages/Scanner.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const PublicCheckin = lazy(() => import('./pages/PublicCheckin.jsx'));
const Corrections = lazy(() => import('./pages/Corrections.jsx'));
const CorrectionsReview = lazy(() => import('./pages/CorrectionsReview.jsx'));
const About = lazy(() => import('./pages/About.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const AuditLog = lazy(() => import('./pages/AuditLog.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const MustChangePassword = lazy(() => import('./pages/MustChangePassword.jsx'));
const Backup = lazy(() => import('./pages/Backup.jsx'));
const Colleges = lazy(() => import('./pages/Colleges.jsx'));
const StudentLogin = lazy(() => import('./pages/portal/StudentLogin.jsx'));
const PortalLayout = lazy(() => import('./pages/portal/PortalLayout.jsx'));
const PortalDashboard = lazy(() => import('./pages/portal/PortalDashboard.jsx'));
const PortalHistory = lazy(() => import('./pages/portal/PortalHistory.jsx'));
const PortalCorrections = lazy(() => import('./pages/portal/PortalCorrections.jsx'));
const PortalAccount = lazy(() => import('./pages/portal/PortalAccount.jsx'));

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
    <DialogProvider>
      <Suspense fallback={<LoadingScreen label="Loading page…" />}>
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
          <Route path="/colleges" element={<Protected><AdminOnly><Colleges /></AdminOnly></Protected>} />
          <Route path="/settings" element={<Protected><AdminOnly><Settings /></AdminOnly></Protected>} />
          <Route path="/reports" element={<Protected><AdminOnly><Reports /></AdminOnly></Protected>} />
          <Route path="/about" element={<Protected><About /></Protected>} />
          <Route path="/profile" element={<Protected><Profile /></Protected>} />
          <Route path="/users" element={<Protected><AdminOnly><Users /></AdminOnly></Protected>} />
          <Route path="/audit" element={<Protected><AdminOnly><AuditLog /></AdminOnly></Protected>} />
          <Route path="/backup" element={<Protected><AdminOnly><Backup /></AdminOnly></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </DialogProvider>
  );
}
