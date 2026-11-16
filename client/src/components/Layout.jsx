import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth.jsx';
import LiveClock from './LiveClock.jsx';
import Footer from './Footer.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import SyncBadge from './SyncBadge.jsx';
import NotificationBell from './NotificationBell.jsx';
import CommandPalette from './CommandPalette.jsx';

const SEARCH_KEY = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K';
const NAV_STATE_KEY = 'attendx_nav_groups_v1';

const NAV_SECTIONS = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: '▦', end: true },
      { to: '/live', label: 'Live Scan', icon: '◉' },
      { to: '/events', label: 'Events', icon: '★' },
      { to: '/corrections/review', label: 'Corrections', icon: '✎' },
    ],
  },
  {
    id: 'people',
    label: 'People & Groups',
    items: [
      { to: '/students', label: 'Students', icon: '◔' },
      { to: '/blocs', label: 'Blocs', icon: '▥' },
      { to: '/schedules', label: 'Schedules', icon: '❖' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    roles: ['admin'],
    items: [
      { to: '/reports', label: 'Reports', icon: '▤', roles: ['admin'] },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    roles: ['admin'],
    items: [
      { to: '/terms', label: 'Terms', icon: '🗓' },
      { to: '/colleges', label: 'Colleges', icon: '🏛' },
      { to: '/users', label: 'Staff', icon: '⚇' },
      { to: '/settings', label: 'Settings', icon: '⚙' },
      { to: '/audit', label: 'Audit Log', icon: '☰' },
      { to: '/backup', label: 'Backup', icon: '⭳' },
    ],
  },
];

function pathMatches(to, end, pathname) {
  if (end) return pathname === to;
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [groupOpen, setGroupOpen] = useState({});

  const sections = useMemo(() => {
    return NAV_SECTIONS
      .filter((section) => !section.roles || section.roles.includes(user?.role))
      .map((section) => ({
        ...section,
        items: (section.items || []).filter((item) => !item.roles || item.roles.includes(user?.role)),
      }))
      .filter((section) => section.items.length > 0);
  }, [user?.role]);

  useEffect(() => {
    const defaults = {};
    for (const section of sections) {
      defaults[section.id] = section.id === 'admin' ? false : true;
    }
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(NAV_STATE_KEY) || '{}') || {};
    } catch {
      stored = {};
    }
    const activeSectionIds = sections
      .filter((section) => section.items.some((item) => pathMatches(item.to, item.end, location.pathname)))
      .map((section) => section.id);
    const next = { ...defaults, ...stored };
    for (const id of activeSectionIds) next[id] = true;
    setGroupOpen(next);
  }, [sections, location.pathname]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleGroup(id) {
    setGroupOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

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

        <nav className="nav nav-grouped" aria-label="Main navigation">
          {sections.map((section) => {
            const expanded = groupOpen[section.id] !== false;
            return (
              <div key={section.id} className={`nav-section ${expanded ? 'open' : 'collapsed'}`}>
                <button
                  type="button"
                  className="nav-section-toggle"
                  onClick={() => toggleGroup(section.id)}
                  aria-expanded={expanded}
                >
                  <span>{section.label}</span>
                  <span className="nav-section-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <div className="nav-section-items">
                    {section.items.map((l) => (
                      <NavLink
                        key={l.to}
                        to={l.to}
                        end={l.end}
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={() => setOpen(false)}
                      >
                        <span className="nav-icon">{l.icon}</span>
                        <span className="nav-label">{l.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <NavLink className="user-chip" to="/profile" onClick={() => setOpen(false)} title="Open profile">
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
          <div className="sidebar-footer-links">
            <NavLink to="/about" className="sidebar-footer-link" onClick={() => setOpen(false)}>About</NavLink>
            <span aria-hidden="true">·</span>
            <button type="button" className="sidebar-footer-link" onClick={() => setShowPassword(true)}>Password</button>
          </div>
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
          <button className="topbar-search" onClick={() => setPaletteOpen(true)} title="Search (⌘K)">
            <span aria-hidden="true">⌕</span>
            <span className="topbar-search-text">Search</span>
            <kbd>{SEARCH_KEY}</kbd>
          </button>
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
