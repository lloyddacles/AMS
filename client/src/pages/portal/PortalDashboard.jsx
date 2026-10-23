import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useStudent } from '../../studentAuth.jsx';
import Spinner from '../../components/Spinner.jsx';

const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');

export default function PortalDashboard() {
  const { student } = useStudent();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .studentDashboard()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) {
    return (
      <div className="card">
        <Spinner label="Loading your dashboard…" size="lg" variant="panel" />
      </div>
    );
  }

  const s = data.summary;
  const breakdown = [
    { label: 'Early', value: s.early, cls: 'pill-cyan' },
    { label: 'On-time', value: s.onTime, cls: 'pill-green' },
    { label: 'Late', value: s.late, cls: 'pill-amber' },
    { label: 'Absent', value: s.absent, cls: 'pill-red' },
    { label: 'Excused', value: s.excused, cls: 'pill-purple' },
    { label: 'Pending', value: s.pending, cls: 'pill-amber' },
    { label: 'Off list', value: s.excluded, cls: 'pill-gray' },
  ];

  return (
    <div className="portal-page">
      <div className="page-head">
        <div>
          <h2>Welcome back, {student.firstName}</h2>
          <p className="muted">Your attendance across all recorded events.</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-sm" to="/portal/history">
            View history
          </Link>
          <Link className="btn btn-sm" to="/portal/corrections">
            My corrections
          </Link>
        </div>
      </div>

      <div className="stat-grid portal-stats">
        <div className="stat-card">
          <div className="stat-value">{s.rate}%</div>
          <div className="stat-label">
            Attendance rate · {s.attended} of {s.finalized} events
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{s.totalEvents}</div>
          <div className="stat-label">Past events recorded</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{s.pending}</div>
          <div className="stat-label">Events still open (pending)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{s.pendingCorrections}</div>
          <div className="stat-label">
            Correction requests awaiting review ·{' '}
            <Link to="/portal/corrections">view</Link>
          </div>
        </div>
      </div>

      <div className="card portal-section">
        <h3 className="section-title">Breakdown</h3>
        <div className="portal-chips">
          {breakdown.map((b) => (
            <span key={b.label} className={`pill ${b.cls}`}>
              {b.label} · {b.value}
            </span>
          ))}
        </div>
        <p className="muted portal-note">
          Rate counts finished events on your attendee list: early, on-time and late check-ins over all
          recorded events. “Off list” events don’t count either way.
        </p>
      </div>

      <div className="card portal-section">
        <h3 className="section-title">Upcoming events</h3>
        {data.upcoming.length === 0 ? (
          <div className="empty">
            <p className="muted">No upcoming events right now.</p>
          </div>
        ) : (
          <ul className="portal-upcoming">
            {data.upcoming.map((e) => (
              <li key={e.eventId}>
                <div className="portal-upcoming-name">
                  {e.name}
                  <span className="pill pill-gray">{e.phase === 'upcoming' ? 'Upcoming' : 'Open now'}</span>
                </div>
                <div className="muted">
                  {fmtDate(e.eventDate)}
                  {e.startTime ? ` · ${e.startTime}` : ''}
                  {e.endTime ? ` – ${e.endTime}` : ''}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
