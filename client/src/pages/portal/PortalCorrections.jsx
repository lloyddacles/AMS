import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Spinner from '../../components/Spinner.jsx';

const TABS = ['pending', 'approved', 'rejected', 'all'];

const STATUS_PILL = { early: 'pill-cyan', 'on-time': 'pill-green', present: 'pill-blue', late: 'pill-amber', excused: 'pill-purple' };
const STATUS_LABEL = { early: 'Early', 'on-time': 'On-time', present: 'Present', late: 'Late', excused: 'Excused' };
const CORR_PILL = { pending: 'pill-amber', approved: 'pill-green', rejected: 'pill-red' };

const fmtDateTime = (v) =>
  v
    ? new Date(String(v).replace(' ', 'T') + 'Z').toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

export default function PortalCorrections() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .studentCorrections({ status: tab, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setCounts(res.counts);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="portal-page">
      <div className="page-head">
        <div>
          <h2>My correction requests</h2>
          <p className="muted">Track what you asked for and how staff resolved it.</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-sm" to="/portal/history">
            + New request from history
          </Link>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            {counts ? ` (${counts[t] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card table-card">
        {loading ? (
          <div style={{ padding: '1rem' }}>
            <Spinner label="Loading requests…" size="lg" variant="panel" />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p className="muted">
              {tab === 'pending' ? 'No requests awaiting review.' : 'Nothing here yet.'}
            </p>
            <Link className="btn btn-sm" to="/portal/history">
              Browse attendance history
            </Link>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Requested</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.eventName}</strong>
                  </td>
                  <td>{r.eventDate}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[r.requestedStatus] || 'pill-gray'}`}>
                      {STATUS_LABEL[r.requestedStatus] || r.requestedStatus}
                    </span>
                  </td>
                  <td className="portal-reason">{r.reason}</td>
                  <td>
                    <span className={`pill ${CORR_PILL[r.status] || 'pill-gray'}`}>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    {r.resolutionNote ? (
                      <div>
                        “{r.resolutionNote}”
                        <div className="muted">
                          {r.reviewedByName ? `${r.reviewedByName} · ` : ''}
                          {fmtDateTime(r.reviewedAt)}
                        </div>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
