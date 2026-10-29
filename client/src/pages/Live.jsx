import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { phaseOf } from '../eventStatus.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateParts(value) {
  const parts = String(value || '').split('-');
  const month = Number(parts[1]);
  return { day: parts[2] || '—', month: MONTHS[month - 1] || '' };
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
  if (!events) return <div className="card"><Spinner label="Finding live events…" size="lg" variant="panel" /></div>;

  const today = todayIso();
  const liveNow = events.filter((e) => e.eventDate === today && phaseOf(e) === 'active').length;
  const todayCount = events.filter((e) => e.eventDate === today).length;
  const scanned = events.reduce((sum, e) => sum + (Number(e.attendanceCount) || 0), 0);
  const roster = events.reduce((sum, e) => sum + (Number(e.totalStudents) || 0), 0);
  const avgRate = roster ? Math.round((scanned / roster) * 100) : 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Check-in"
        title="Live Scan"
        subtitle="Jump straight into check-in for the event happening now."
        actions={<Link className="btn" to="/events">Manage events</Link>}
      />

      {events.length > 0 && (
        <div className="stat-grid">
          <StatCard icon="live" accent="green" label="Live now" value={liveNow} hint="Open for check-in today" />
          <StatCard icon="calendar" accent="blue" label="Events today" value={todayCount} hint="Scheduled for today" />
          <StatCard icon="check" accent="purple" label="Check-ins" value={scanned} hint="Across open events" />
          <StatCard icon="chart" accent="amber" label="Avg attendance" value={`${avgRate}%`} hint="Scanned vs roster" />
        </div>
      )}

      {events.length === 0 && (
        <div className="empty card">
          <h3>No active events</h3>
          <p className="muted">There are no open events to scan right now.</p>
          <Link className="btn btn-primary" to="/events">Go to Events</Link>
        </div>
      )}

      <div className="live-grid">
        {events.map((ev) => {
          const isToday = ev.eventDate === today;
          const phase = phaseOf(ev);
          const rate = ev.totalStudents ? Math.round((ev.attendanceCount / ev.totalStudents) * 100) : 0;
          const { day, month } = dateParts(ev.eventDate);
          const topPill = phase === 'upcoming'
            ? { cls: 'pill-blue', label: 'Coming Soon' }
            : isToday
              ? { cls: 'pill-green', label: 'Happening today' }
              : { cls: 'pill-blue', label: ev.eventDate };
          const isLive = isToday && phase === 'active';
          return (
            <div key={ev.id} className={`card live-card ${isLive ? 'live-today' : ''}`}>
              <div className="live-card-top">
                <span className={`pill ${topPill.cls}`}>
                  {isLive && <span className="live-dot" />}
                  {topPill.label}
                </span>
                <span className="muted small mono">
                  {ev.startTime || '—'}{ev.endTime ? `–${ev.endTime}` : ''}
                </span>
              </div>
              <div className="name-cell">
                <span className="date-chip">
                  <strong>{day}</strong>
                  <span>{month}</span>
                </span>
                <div>
                  <h3>{ev.name}</h3>
                  <p className="muted small">{ev.location || 'Location TBD'}</p>
                </div>
              </div>
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
