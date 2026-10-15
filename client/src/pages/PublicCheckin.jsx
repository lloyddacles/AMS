import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import LiveClock from '../components/LiveClock.jsx';
import Footer from '../components/Footer.jsx';

export default function PublicCheckin() {
  const { code } = useParams();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const [today, setToday] = useState({ count: 0, students: [] });

  useEffect(() => {
    api
      .publicEvent(code)
      .then(setEvent)
      .catch((e) => setError(e.message));
    api.publicTodayCheckins()
      .then(setToday)
      .catch(() => {});
  }, [code]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.publicCheckin(code, studentNo);
      setDone(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !event) {
    return (
      <div className="public-page">
        <div className="login-card">
          <h2>Check-in unavailable</h2>
          <p className="muted">{error}</p>
        </div>
        <Footer compact />
      </div>
    );
  }

  return (
    <div className="public-page">
      <div className="login-card">
        <LiveClock className="public-clock" />
        <div className="login-brand">
          <span className="brand-mark lg"><img src="/logo.jpg" alt="AttendX logo" /></span>
          <h1>{event?.name || 'AttendX Check-in'}</h1>
          <p>
            {event?.eventDate}
            {event?.startTime ? ` · ${event.startTime}` : ''}
            {event?.location ? ` · ${event.location}` : ''}
          </p>
        </div>

        {done ? (
          <div className="checkin-done">
            <div className="checkin-check">✓</div>
            <h3>
              {done.action === 'time-in' ? 'Timed in' : done.action === 'time-out' ? 'Timed out' : 'Already completed'}
            </h3>
            <p className="strong">{done.lastName}, {done.firstName}</p>
            <p className="muted">
              {done.studentNo} ·{' '}
              <span className={`pill ${done.status === 'late' ? 'pill-amber' : 'pill-green'}`}>{done.status}</span>
            </p>
            {done.action === 'time-out' && done.checkedInAt && (
              <p className="muted small">Time in: {new Date(done.checkedInAt + 'Z').toLocaleTimeString()}</p>
            )}
            {done.action === 'already-complete' && (
              <p className="muted small">You already have a complete time-in and time-out for this event.</p>
            )}
          </div>
        ) : event?.status !== 'active' ? (
          <div className="alert alert-error">Check-in for this event is currently closed.</div>
        ) : (
          <>
            <form className="form" onSubmit={submit}>
              <label>
                Enter your Student Number
                <input
                  value={studentNo}
                  onChange={(e) => setStudentNo(e.target.value)}
                  placeholder="e.g. 2024-0001"
                  autoFocus
                />
              </label>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Recording…' : 'Mark My Attendance'}
              </button>
            </form>
            <div className="today-list" style={{ marginTop: '1rem', width: '100%' }}>
              <h4 style={{ marginBottom: '0.5rem' }}>Already checked in today ({today.count})</h4>
              <ul className="list" style={{ maxHeight: '12rem', overflow: 'auto' }}>
                {today.students.length === 0 && <li className="muted small">No one yet.</li>}
                {today.students.map((t, i) => (
                  <li key={i} className="list-row" style={{ padding: '0.35rem 0' }}>
                    <div>
                      <div className="strong">{t.lastName}, {t.firstName}</div>
                    </div>
                    <div className="muted small">{t.checkedInAt ? new Date(t.checkedInAt + 'Z').toLocaleTimeString() : '—'}</div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
      <Footer compact />
    </div>
  );
}
