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
import Scanner from './pages/Scanner.jsx';
import Live from './pages/Live.jsx';
import Reports from './pages/Reports.jsx';
import PublicCheckin from './pages/PublicCheckin.jsx';
import About from './pages/About.jsx';
import Profile from './pages/Profile.jsx';
import Users from './pages/Users.jsx';
import AuditLog from './pages/AuditLog.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Layout>{children}</Layout>;
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
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/students" element={<Protected><Students /></Protected>} />
      <Route path="/students/qr-sheet" element={<Protected><QrSheet /></Protected>} />
      <Route path="/live" element={<Protected><Live /></Protected>} />
      <Route path="/events" element={<Protected><Events /></Protected>} />
      <Route path="/events/:id" element={<Protected><EventDetail /></Protected>} />
      <Route path="/events/:id/scan" element={<Protected><Scanner /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/about" element={<Protected><About /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/users" element={<Protected><AdminOnly><Users /></AdminOnly></Protected>} />
      <Route path="/audit" element={<Protected><AdminOnly><AuditLog /></AdminOnly></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
