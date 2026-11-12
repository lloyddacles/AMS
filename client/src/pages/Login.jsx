import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { takeIdleLogout } from '../idle.js';
import Footer from '../components/Footer.jsx';
import LoginArt from '../components/LoginArt.jsx';

const FEATURES = [
  'Instant QR check-in and time-out',
  'Live attendance records & reports',
  'Offline-ready scanning with auto-sync',
];

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [idleNotice, setIdleNotice] = useState(() => takeIdleLogout());

  useEffect(() => {
    if (!idleNotice) return undefined;
    const timer = setTimeout(() => setIdleNotice(false), 8000);
    return () => clearTimeout(timer);
  }, [idleNotice]);

  useEffect(() => {
    if (user) navigate(location.state?.from?.pathname || '/', { replace: true });
  }, [user, location, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || 'Unable to sign in. Please check your credentials.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page modern-auth-page">
      <div className="login-shell modern-login-shell">
        <aside className="login-visual modern-login-visual">
          <div className="login-visual-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <div>
              <h1>AttendX</h1>
              <p>Attendance Monitoring System</p>
            </div>
          </div>
          <LoginArt className="login-art" />
          <div className="login-visual-copy">
            <p className="login-visual-tag">A modern platform for attendance tracking, reporting, and student support.</p>
            <ul className="login-features">
              {FEATURES.map((f) => (
                <li key={f}>
                  <span className="login-feature-tick" aria-hidden="true">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="login-card modern-login-card">
          <div className="auth-card-top">
            <Link to="/" className="auth-back-link">← Back to home</Link>
          </div>
          <div className="login-brand modern-login-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <h1>Staff / Admin Sign In</h1>
            <p>Access your dashboard to manage attendance, events, students, and reports.</p>
          </div>

          {idleNotice && (
            <div className="alert alert-warn">Signed out due to inactivity after 5 minutes.</div>
          )}

          <form onSubmit={handleSubmit} className="form modern-auth-form">
            <label>
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username" autoComplete="username" autoFocus required />
            </label>
            <label>
              <span>Password</span>
              <div className="auth-password-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button type="button" className="btn btn-sm" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="portal-auth-switch modern-auth-links">
            <Link to="/portal/login">Student portal sign-in →</Link>
            <span aria-hidden="true">·</span>
            <Link to="/corrections">Attendance correction</Link>
          </div>
        </div>
      </div>
      <Footer compact />
    </div>
  );
}
