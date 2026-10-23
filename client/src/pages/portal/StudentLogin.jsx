import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStudent } from '../../studentAuth.jsx';
import { takeIdleLogout } from '../../idle.js';
import Footer from '../../components/Footer.jsx';
import LiveClock from '../../components/LiveClock.jsx';

export default function StudentLogin() {
  const { student, signIn, setup } = useStudent();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [studentNo, setStudentNo] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'setup' && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(studentNo, password);
      else await setup({ studentNo, name, password });
      navigate('/portal', { replace: true });
    } catch (err) {
      if (err.status === 403 && err.code === 'SETUP_REQUIRED' && mode === 'signin') {
        setMode('setup');
        setError('Your account has no password yet — set one up to continue.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-page">
      <div className="login-card wide-card">
        <LiveClock className="public-clock" />
        <div className="login-brand">
          <span className="brand-mark lg">
            <img src="/logo.png" alt="AttendX logo" />
          </span>
          <h1>Student Portal</h1>
          <p className="muted">
            {mode === 'signin'
              ? 'Sign in to see your attendance history and correction requests.'
              :               'First time here? Verify your details and choose a password.'}
          </p>
        </div>
        {idleNotice && (
          <div className="alert alert-warn">Signed out due to inactivity after 5 minutes.</div>
        )}
        <form className="form" onSubmit={submit}>
          <label>
            Student Number
            <input value={studentNo} onChange={(e) => setStudentNo(e.target.value)} placeholder="e.g. 2024-0001" autoFocus required />
          </label>
          {mode === 'setup' && (
            <label>
              Full Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="As registered, e.g. Juan Dela Cruz" required />
            </label>
          )}
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </label>
          {mode === 'setup' && (
            <label>
              Confirm Password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required />
            </label>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? (mode === 'signin' ? 'Signing in…' : 'Setting up…') : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="portal-auth-switch">
          {mode === 'signin' ? (
            <button type="button" className="linklike" onClick={() => switchMode('setup')}>
              First time? Set up your account →
            </button>
          ) : (
            <button type="button" className="linklike" onClick={() => switchMode('signin')}>
              ← Already set up? Sign in
            </button>
          )}
        </div>
        <div className="portal-auth-switch muted">
          <Link to="/login">Staff sign-in</Link>
          <span aria-hidden="true">·</span>
          <Link to="/corrections">Quick corrections lookup (no account)</Link>
        </div>
      </div>
      <Footer compact />
    </div>
  );
}
