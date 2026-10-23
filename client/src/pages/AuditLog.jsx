import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Spinner from '../components/Spinner.jsx';

const ACTION_LABEL = {
  'attendance.mark': 'Marked attendance',
  'attendance.update': 'Changed attendance',
  'attendance.delete': 'Cleared attendance',
  'correction.request': 'Requested correction',
  'correction.approve': 'Approved correction',
  'correction.reject': 'Rejected correction',
  'event.create': 'Created event',
  'event.update': 'Edited event',
  'event.close': 'Closed event',
  'event.reopen': 'Reopened event',
  'event.delete': 'Deleted event',
  'event.regenerate-code': 'Regenerated event code',
  'student.create': 'Added student',
  'student.update': 'Edited student',
  'student.delete': 'Deleted student',
  'student.bulk-create': 'Bulk-imported students',
  'student.regenerate-qr': 'Regenerated student QR',
  'student.setup': 'Created portal account',
  'student.password-change': 'Changed portal password',
  'student.portal-reset': 'Reset portal password',
  'user.create': 'Created account',
  'user.update': 'Updated account',
  'user.delete': 'Deleted account',
  'user.reset-password': 'Reset password',
};

const ACTION_TONE = {
  delete: 'pill-red',
  'attendance.delete': 'pill-red',
  close: 'pill-amber',
};

const PAGE_SIZE = 25;

function fmt(sqliteUtc) {
  if (!sqliteUtc) return '—';
  return new Date(String(sqliteUtc).replace(' ', 'T') + 'Z').toLocaleString();
}

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await api.getAudit({
        search,
        entity,
        userId,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setRows(data.rows);
      setTotal(data.total);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.getAuditActors().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, entity, userId, page]);

  useEffect(() => {
    setPage(1);
  }, [search, entity, userId]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Audit Log</h2>
          <p className="muted">A record of changes made to attendance, events, students, and accounts.</p>
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search by user, action, or detail…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All entities</option>
          <option value="attendance">Attendance</option>
          <option value="event">Events</option>
          <option value="student">Students</option>
          <option value="user">Accounts</option>
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={4} className="center"><Spinner label="Loading activity…" size="sm" variant="center" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={4} className="muted center">No activity found.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted small">{fmt(r.createdAt)}</td>
                <td className="strong">{r.userName || '—'}</td>
                <td>
                  <span className={`pill ${ACTION_TONE[r.action] || 'pill-gray'}`}>
                    {ACTION_LABEL[r.action] || r.action}
                  </span>
                </td>
                <td className="muted small">{r.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="pagination">
          <span className="muted small">Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
          <div className="pager">
            <button className="btn btn-sm" onClick={() => setPage(1)} disabled={page === 1}>« First</button>
            <button className="btn btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹ Prev</button>
            <span className="pager-info">Page {page} of {pageCount}</span>
            <button className="btn btn-sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}>Next ›</button>
            <button className="btn btn-sm" onClick={() => setPage(pageCount)} disabled={page === pageCount}>Last »</button>
          </div>
        </div>
      )}
    </div>
  );
}
