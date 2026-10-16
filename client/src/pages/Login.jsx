import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <aside className="login-visual">
          <div className="login-visual-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <div>
              <h1>AttendX</h1>
              <p>Attendance Monitoring System</p>
            </div>
          </div>
          <LoginArt className="login-art" />
          <div className="login-visual-copy">
            <p className="login-visual-tag">Fast, accurate, and paperless attendance for your school.</p>
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

        <div className="login-card">
          <div className="login-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <h1>Welcome back</h1>
            <p>Sign in to your account to continue.</p>
          </div>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
      <Footer compact />
    </div>
  );
}
