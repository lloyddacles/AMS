import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { phaseOf } from '../eventStatus.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REFRESH_MS = 30000;

const STATUS_META = {
  early: { label: 'Early', pill: 'pill-cyan' },
  'on-time': { label: 'On time', pill: 'pill-green' },
  late: { label: 'Late', pill: 'pill-amber' },
  excused: { label: 'Excused', pill: 'pill-purple' },
  absent: { label: 'Absent', pill: 'pill-red' },
};

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

function fmtTime(value) {
  if (!value) return '';
  const raw = String(value);
  const d = new Date(raw.includes('T') ? raw : `${raw}Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function span(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function countdown(event, nowIso) {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const start = event.startAt ? new Date(event.startAt).getTime() : null;
  const end = event.endAt ? new Date(event.endAt).getTime() : null;
  if (start && now < start) return `Starts in ${span(start - now)}`;
  if (end && now < end) return `Ends in ${span(end - now)}`;
  if (end && now >= end) return `Ended ${span(now - end)} ago`;
  if (start && now >= start) return `Started ${span(now - start)} ago`;
  return '';
}

function initials(first, last) {
  return `${String(first || '').charAt(0)}${String(last || '').charAt(0)}`.toUpperCase() || '?';
}

// Rank events so the most relevant "happening now" ones come first: today's
// active events, then upcoming active events (soonest first), then recent past
// active events (most recent first).
function rankEvents(events) {
  const today = todayIso();
  const order = (e) => (e.eventDate === today ? 0 : e.eventDate > today ? 1 : 2);
  return [...events].sort((a, b) => {
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    if (oa === 2) return String(b.eventDate).localeCompare(String(a.eventDate));
    if (String(a.eventDate) !== String(b.eventDate)) return String(a.eventDate).localeCompare(String(b.eventDate));
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
}

export default function Live() {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load({ quiet = false } = {}) {
    if (!quiet) setRefreshing(true);
    try {
      const data = await api.getLiveBoard();
      setBoard(data);
      setError('');
    } catch (e) {
      if (!quiet) setError(e.message);
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    }, REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function closeEvent(event) {
    if (!confirm(`Close "${event.name}"?\n\nStudents without a check-in will be recorded as absent and the final report will be locked.`)) {
      return;
    }
    setClosing(event.id);
    try {
      await api.closeEvent(event.id);
      await load({ quiet: true });
    } catch (e) {
      alert(e.message);
    } finally {
      setClosing(null);
    }
  }

  if (error && !board) return <div className="alert alert-error">{error}</div>;
  if (!board) return <div className="card"><Spinner label="Loading the live board…" size="lg" variant="panel" /></div>;

  const events = rankEvents(board.events || []);
  const today = todayIso();
  const liveNow = events.filter((e) => e.eventDate === today && phaseOf(e) === 'active').length;
  const checked = events.reduce((sum, e) => sum + (Number(e.board?.attended) || 0), 0);
  const expected = events.reduce((sum, e) => sum + (Number(e.board?.expected) || 0), 0);
  const avgRate = expected ? Math.round((checked / expected) * 100) : 0;
  const updated = fmtTime(board.now);

  return (
    <div className="page live-page">
      <PageHeader
        eyebrow="Check-in"
        title="Live Scan"
        subtitle="Monitor check-ins in real time, track turnout, and close events when they end."
        actions={
          <>
            <span className={`live-updated ${refreshing ? 'is-refreshing' : ''}`}>{updated ? `Updated ${updated}` : 'Live'}</span>
            <button className="btn" onClick={() => load()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link className="btn" to="/events">Manage events</Link>
          </>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}

      {events.length > 0 && (
        <div className="stat-grid">
          <StatCard icon="live" accent="green" label="Live now" value={liveNow} hint="Open for check-in today" />
          <StatCard icon="calendar" accent="blue" label="Open events" value={events.length} hint="Active or starting soon" />
          <StatCard icon="check" accent="purple" label="Check-ins" value={checked} hint={`of ${expected} expected`} />
          <StatCard icon="chart" accent="amber" label="Avg attendance" value={`${avgRate}%`} hint="Checked in vs roster" />
        </div>
      )}

      {events.length === 0 && (
        <div className="empty card live-empty">
          <div className="events-empty-icon">◉</div>
          <h3>No live events</h3>
          <p className="muted">There are no open events to monitor right now. Create or open an event to start scanning attendance.</p>
          <div className="head-actions" style={{ justifyContent: 'center', marginLeft: 0 }}>
            <Link className="btn btn-primary" to="/events">Go to Events</Link>
            <Link className="btn" to="/schedules">View Schedules</Link>
          </div>
        </div>
      )}



      <div className="live-grid">
        {events.map((ev) => {
          const data = ev.board || {};
          const isToday = ev.eventDate === today;
          const phase = phaseOf(ev);
          const rate = data.expected ? Math.round((data.attended / data.expected) * 100) : 0;
          const { day, month } = dateParts(ev.eventDate);
          const topPill = phase === 'upcoming'
            ? { cls: 'pill-blue', label: 'Coming Soon' }
            : isToday
              ? { cls: 'pill-green', label: 'Happening today' }
              : { cls: 'pill-blue', label: ev.eventDate };
          const isLive = isToday && phase === 'active';
          const remaining = countdown(ev, board.now);
          const breakdown = [
            ['early', 'Early'],
            ['onTime', 'On time'],
            ['late', 'Late'],
            ['excused', 'Excused'],
            ['absent', 'Absent'],
          ].filter(([key]) => key !== 'excused' || Number(data[key]) > 0);
          const scans = data.recentScans || [];

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

              {remaining && <span className="live-countdown">{remaining}</span>}

              <div>
                <div className="rate-wrap">
                  <div className={`rate-bar ${rate < 50 ? 'danger' : ''}`}>
                    <span style={{ width: `${Math.min(100, rate)}%` }} />
                  </div>
                  <span className="rate-label">{data.attended || 0}/{data.expected || 0}</span>
                </div>
                <div className="live-breakdown">
                  {breakdown.map(([key, label]) => (
                    <span key={key} className={`live-breakdown-item is-${key}`}>
                      <strong>{Number(data[key]) || 0}</strong> {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="live-feed">
                <span className="live-feed-label">Recent scans</span>
                {scans.length === 0 ? (
                  <p className="muted small">No scans yet — students will appear here as they check in.</p>
                ) : (
                  <ul className="live-scan-list">
                    {scans.slice(0, 4).map((s) => {
                      const meta = STATUS_META[s.status] || STATUS_META['on-time'];
                      const when = s.checkedInAt || s.checkedOutAt;
                      return (
                        <li key={`${s.studentId}-${when || s.method}`} className="live-scan-row">
                          <span className="mini-avatar">{initials(s.firstName, s.lastName)}</span>
                          <span className="live-scan-name">{s.lastName}, {s.firstName}</span>
                          <span className={`pill ${meta.pill}`}>{meta.label}</span>
                          <span className="live-scan-time">{fmtTime(when)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="live-card-actions">
                <Link className="btn btn-primary" to={`/events/${ev.id}/scan`}>Start scanning</Link>
                <Link className="btn" to={`/events/${ev.id}`}>Open event</Link>
                {phase === 'active' && (
                  <button
                    className="btn"
                    onClick={() => closeEvent(ev)}
                    disabled={closing === ev.id}
                  >
                    {closing === ev.id ? 'Closing…' : 'Close event'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
