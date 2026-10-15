import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import LiveClock from './LiveClock.jsx';
import Footer from './Footer.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import SyncBadge from './SyncBadge.jsx';
import NotificationBell from './NotificationBell.jsx';

const links = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/live', label: 'Live Scan', icon: '◉' },
  { to: '/students', label: 'Students', icon: '◔' },
  { to: '/events', label: 'Events', icon: '★' },
  { to: '/reports', label: 'Reports', icon: '▤' },
  { to: '/users', label: 'Staff', icon: '⚇', roles: ['admin'] },
  { to: '/audit', label: 'Audit Log', icon: '☰', roles: ['admin'] },
  { to: '/backup', label: 'Backup', icon: '⭳', roles: ['admin'] },
  { to: '/about', label: 'About', icon: 'ⓘ' },
  { to: '/profile', label: 'Profile', icon: '☺' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function handlePasswordChanged() {
    setShowPassword(false);
    setToast('Password updated');
    setTimeout(() => setToast(''), 2500);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><img src="/logo.png" alt="AttendX logo" /></span>
          <span className="brand-text">AttendX</span>
        </div>
        <nav className="nav">
          {links
            .filter((l) => !l.roles || l.roles.includes(user?.role))
            .map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="nav-icon">{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <NavLink className="user-chip" to="/profile" onClick={() => setOpen(false)}>
            {user?.avatar ? (
              <img className="avatar" src={user.avatar} alt="" />
            ) : (
              <span className="avatar">{user?.name?.[0]?.toUpperCase() || 'A'}</span>
            )}
            <div>
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{user?.role}</div>
            </div>
          </NavLink>
          <button className="btn btn-ghost btn-block" onClick={() => setShowPassword(true)}>
            Change password
          </button>
          <button className="btn btn-ghost btn-block" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            ☰
          </button>
          <span className="topbar-title">AttendX</span>
          <NotificationBell />
          <SyncBadge />
          <LiveClock className="topbar-clock" />
        </header>
        <main className="content">{children}</main>
        <Footer />
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      {showPassword && (
        <ChangePasswordModal onClose={() => setShowPassword(false)} onSuccess={handlePasswordChanged} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
