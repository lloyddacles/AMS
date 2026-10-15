import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Rank events so the most relevant "happening now" ones come first: today's
// active events, then upcoming active events (soonest first), then recent past
// active events (most recent first).
function rankEvents(events) {
  const today = todayIso();
  const active = events.filter((e) => e.status === 'active');
  const order = (e) => (e.eventDate === today ? 0 : e.eventDate > today ? 1 : 2);
  return active.sort((a, b) => {
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    if (oa === 2) return String(b.eventDate).localeCompare(String(a.eventDate));
    if (String(a.eventDate) !== String(b.eventDate)) return String(a.eventDate).localeCompare(String(b.eventDate));
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
}

export default function Live() {
  const navigate = useNavigate();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [autoTried, setAutoTried] = useState(false);

  useEffect(() => {
    api
      .getEvents()
      .then((rows) => setEvents(rankEvents(rows)))
      .catch((e) => setError(e.message));
  }, []);

  // With a single live event, skip the extra click and open the scanner.
  useEffect(() => {
    if (events && events.length === 1 && !autoTried) {
      setAutoTried(true);
      navigate(`/events/${events[0].id}/scan`, { replace: true });
    }
  }, [events, autoTried, navigate]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!events) return <div className="muted">Loading…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Live Scan</h2>
          <p className="muted">Jump straight into check-in for the event happening now.</p>
        </div>
        <Link className="btn" to="/events">Manage events</Link>
      </div>

      {events.length === 0 && (
        <div className="empty card">
          <h3>No active events</h3>
          <p className="muted">There are no open events to scan right now.</p>
          <Link className="btn btn-primary" to="/events">Go to Events</Link>
        </div>
      )}

      <div className="live-grid">
        {events.map((ev) => {
          const isToday = ev.eventDate === todayIso();
          const rate = ev.totalStudents ? Math.round((ev.attendanceCount / ev.totalStudents) * 100) : 0;
          return (
            <div key={ev.id} className={`card live-card ${isToday ? 'live-today' : ''}`}>
              <div className="live-card-top">
                <span className={`pill ${isToday ? 'pill-green' : 'pill-blue'}`}>{isToday ? 'Happening today' : ev.eventDate}</span>
                <span className="muted small">{ev.startTime || '—'}{ev.endTime ? `–${ev.endTime}` : ''}</span>
              </div>
              <h3>{ev.name}</h3>
              <p className="muted small">{ev.location || 'Location TBD'}</p>
              <div className="rate-wrap">
                <div className="rate-bar"><span style={{ width: `${rate}%` }} /></div>
                <span className="rate-label">{ev.attendanceCount}/{ev.totalStudents}</span>
              </div>
              <div className="live-card-actions">
                <Link className="btn btn-primary" to={`/events/${ev.id}/scan`}>Start scanning</Link>
                <Link className="btn" to={`/events/${ev.id}`}>Open event</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
