import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStudent } from '../../studentAuth.jsx';
import { takeIdleLogout } from '../../idle.js';
import Footer from '../../components/Footer.jsx';
import LiveClock from '../../components/LiveClock.jsx';
import LoginArt from '../../components/LoginArt.jsx';

const FEATURES = [
  'View your attendance history and status details',
  'Track attendance rate, upcoming events, and records',
  'Submit and monitor attendance correction requests',
  'Manage your student portal account securely',
];

export default function StudentLogin() {
  const { student, signIn, setup } = useStudent();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [studentNo, setStudentNo] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    if (student) navigate('/portal', { replace: true });
  }, [student, navigate]);

  function switchMode(next) {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
    setShowPassword(false);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    const no = String(studentNo || '').trim();
    if (!no) {
      setError('Please enter your student number.');
      return;
    }
    if (mode === 'setup' && !String(name || '').trim()) {
      setError('Please enter your full name as registered.');
      return;
    }
    if (String(password).length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (mode === 'setup' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') await signIn(no, password);
      else await setup({ studentNo: no, name: String(name).trim(), password });
      navigate('/portal', { replace: true });
    } catch (err) {
      if (err.status === 403 && err.code === 'SETUP_REQUIRED' && mode === 'signin') {
        setMode('setup');
        setError('Your account is not set up yet. Verify your details and create a password to continue.');
      } else {
        setError(err.message || 'Unable to sign in. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page student-login-page modern-auth-page">
      <div className="login-shell student-login-shell modern-login-shell">
        <aside className="login-visual student-login-visual modern-login-visual">
          <div className="login-visual-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <div>
              <h1>AttendX</h1>
              <p>Student Portal</p>
            </div>
          </div>
          <LoginArt className="login-art" />
          <div className="login-visual-copy">
            <p className="login-visual-tag">Access your attendance records, track progress, and submit correction requests securely.</p>
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

        <div className="login-card student-login-card modern-login-card">
          <div className="auth-card-top auth-card-top-split">
            <Link to="/" className="auth-back-link">← Back to home</Link>
            <LiveClock className="public-clock" />
          </div>

          <div className="login-brand student-login-brand modern-login-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <h1>Student Portal Access</h1>
            <p>{mode === 'signin' ? 'Sign in to view your attendance records and account details.' : 'Set up your account to start using the student portal.'}</p>
          </div>

          <div className="student-auth-tabs" role="tablist" aria-label="Student portal access">
            <button
              type="button"
              className={mode === 'signin' ? 'active' : ''}
              onClick={() => switchMode('signin')}
              role="tab"
              aria-selected={mode === 'signin'}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === 'setup' ? 'active' : ''}
              onClick={() => switchMode('setup')}
              role="tab"
              aria-selected={mode === 'setup'}
            >
              First-time setup
            </button>
          </div>

          {idleNotice && (
            <div className="alert alert-warn">Signed out due to inactivity after 5 minutes.</div>
          )}

          <form className="form student-login-form modern-auth-form" onSubmit={submit}>
            <label>
              <span>Student Number <span className="req">*</span></span>
              <input
                value={studentNo}
                onChange={(e) => setStudentNo(e.target.value)}
                placeholder="e.g. 2024-0001"
                autoComplete="username"
                autoFocus
                required
              />
            </label>

            {mode === 'setup' && (
              <label>
                <span>Full Name (as registered) <span className="req">*</span></span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  autoComplete="name"
                  required
                />
                <span className="muted small">Used to verify your identity before creating your portal password.</span>
              </label>
            )}

            <label>
              <span>{mode === 'signin' ? 'Password' : 'Create Password'} <span className="req">*</span></span>
              <div className="student-password-row auth-password-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <span className="muted small">Minimum 6 characters.</span>
            </label>

            {mode === 'setup' && (
              <label>
                <span>Confirm Password <span className="req">*</span></span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                  required
                />
              </label>
            )}

            {error && <div className="alert alert-error">{error}</div>}

            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? (mode === 'signin' ? 'Signing in…' : 'Setting up account…') : mode === 'signin' ? 'Sign in to Portal' : 'Create Student Account'}
            </button>
          </form>

          <div className="student-login-help card">
            <h4>{mode === 'signin' ? 'Need access?' : 'Setup instructions'}</h4>
            {mode === 'signin' ? (
              <ul>
                <li>Use the student number and password you created for the portal.</li>
                <li>If this is your first time, choose <strong>First-time setup</strong>.</li>
                <li>If you forgot your password, contact your teacher/admin for a reset.</li>
              </ul>
            ) : (
              <ul>
                <li>Enter your <strong>student number</strong> and <strong>full name</strong> exactly as registered.</li>
                <li>Create a password (at least 6 characters) for your account.</li>
                <li>After setup, sign in anytime to view attendance and submit corrections.</li>
              </ul>
            )}
          </div>

          <div className="portal-auth-switch student-auth-links modern-auth-links">
            <Link to="/login">Staff/Admin sign-in</Link>
            <span aria-hidden="true">·</span>
            <Link to="/corrections">Quick corrections lookup</Link>
          </div>
        </div>
      </div>
      <Footer compact />
    </div>
  );
}
