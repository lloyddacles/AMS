import { useEffect, useRef, useState } from 'react';
import { api, downloadBackup } from '../api.js';
import Spinner from '../components/Spinner.jsx';

const LABELS = {
  users: 'Accounts',
  students: 'Students',
  events: 'Events',
  attendance: 'Attendance records',
  settings: 'Settings',
  scan_receipts: 'Offline scan receipts',
  audit_log: 'Audit entries',
};

export default function Backup() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const fileRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      setSummary(await api.getBackupSummary());
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  }

  async function download() {
    setBusy(true);
    setError('');
    try {
      await downloadBackup();
      flash('Backup downloaded');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !data.tables) throw new Error('That file is not a valid AttendX backup');
      setPending(data);
      setConfirmText('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function restore() {
    if (confirmText !== 'RESTORE') return;
    setBusy(true);
    setError('');
    try {
      const result = await api.restoreBackup(pending);
      setPending(null);
      await load();
      const total = Object.values(result.counts || {}).reduce((a, b) => a + b, 0);
      flash(`Restore complete — ${total} records imported`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Backup &amp; Restore</h2>
          <p className="muted">Download a full copy of the database, or restore from a backup file.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <div className="card">
        <div className="card-head">
          <h3>Current data</h3>
          {summary && (
            <span className="muted small">
              {summary.students} students · {summary.events} events · {summary.attendance} records
            </span>
          )}
        </div>
        {loading && !summary ? (
          <Spinner label="Loading…" size="lg" variant="panel" />
        ) : (
          <div className="backup-grid">
            {summary &&
              Object.entries(summary).map(([key, value]) => (
                <div className="backup-stat" key={key}>
                  <div className="backup-value">{value}</div>
                  <div className="backup-label">{LABELS[key] || key}</div>
                </div>
              ))}
          </div>
        )}
        <div className="backup-actions">
          <button className="btn btn-primary" onClick={download} disabled={busy}>
            {busy ? 'Working…' : 'Download backup (.json)'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Restore from backup</h3>
        </div>
        <div className="alert alert-warn">
          Restoring replaces <strong>all</strong> current data with the contents of the backup file.
          This cannot be undone — download a fresh backup first.
        </div>
        <div className="backup-actions">
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            Choose backup file…
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
        </div>
      </div>

      {pending && (
        <div className="card">
          <div className="card-head">
            <h3>Confirm restore</h3>
          </div>
          <p className="muted">
            Backup exported {pending.exportedAt ? new Date(pending.exportedAt).toLocaleString() : 'unknown'} ·
            {' '}
            {pending.tables?.students?.length ?? 0} students · {pending.tables?.attendance?.length ?? 0} records
          </p>
          <label>
            Type <strong>RESTORE</strong> to confirm
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
          </label>
          <div className="backup-actions">
            <button className="btn" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-danger" onClick={restore} disabled={busy || confirmText !== 'RESTORE'}>
              {busy ? 'Restoring…' : 'Replace all data'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
