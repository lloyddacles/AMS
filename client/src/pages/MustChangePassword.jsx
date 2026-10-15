import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function MustChangePassword() {
  const { user, logout, updateUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) return setError('New password must be at least 6 characters');
    if (newPassword !== confirm) return setError('New passwords do not match');
    setBusy(true);
    try {
      const { user: updated } = await api.changePassword(currentPassword, newPassword);
      updateUser(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
          <h1>Set a new password</h1>
          <p>
            Hi {user?.name || 'there'} — for security, please replace your default password before
            continuing.
          </p>
        </div>
        <form onSubmit={submit} className="form">
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
        <p className="login-hint">
          <button type="button" className="link" onClick={logout}>Sign out</button>
        </p>
      </div>
    </div>
  );
}
