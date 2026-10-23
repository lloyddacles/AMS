import { useState } from 'react';
import { api } from '../../api.js';
import { useStudent } from '../../studentAuth.jsx';

export default function PortalAccount() {
  const { student } = useStudent();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  async function changePassword(e) {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (next.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      await api.studentChangePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setToast('Password updated.');
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-page">
      <div className="page-head">
        <div>
          <h2>Account</h2>
          <p className="muted">Your profile and portal password.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card portal-section">
          <h3 className="section-title">Profile</h3>
          <dl className="portal-fields">
            <div>
              <dt>Student number</dt>
              <dd>{student.studentNo}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>
                {student.firstName} {student.lastName}
              </dd>
            </div>
            <div>
              <dt>Course / Year / Section</dt>
              <dd>
                {student.course || '—'}
                {student.yearLevel ? ` · ${student.yearLevel}` : ''}
                {student.section ? ` · ${student.section}` : ''}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{student.email || '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="card portal-section">
          <h3 className="section-title">Change password</h3>
          <form className="form" onSubmit={changePassword}>
            <label>
              Current password
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </label>
            <label>
              New password
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required />
            </label>
            <label>
              Confirm new password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
