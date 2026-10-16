import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { api, exportCsv } from '../api.js';
import { phaseOf, EVENT_PHASES } from '../eventStatus.js';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const STATUSES = ['present', 'late', 'excused', 'absent'];
const statusClass = {
  early: 'pill-cyan',
  'on-time': 'pill-green',
  present: 'pill-blue',
  late: 'pill-amber',
  excused: 'pill-purple',
  absent: 'pill-red',
};
const statusLabel = {
  early: 'Early',
  'on-time': 'On-time',
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
};
const statusShort = {
  early: 'E',
  'on-time': 'O',
  present: 'P',
  late: 'L',
  excused: 'X',
  absent: 'A',
};
const ATTENDED = ['early', 'on-time', 'present', 'late'];
const ALL_STATUSES = ['early', 'on-time', 'present', 'late', 'excused', 'absent'];

function fmtTime(sqliteUtc) {
  if (!sqliteUtc) return '—';
  try {
    return new Date(String(sqliteUtc).replace(' ', 'T') + 'Z').toLocaleTimeString();
  } catch {
    return '—';
  }
}

function duration(inAt, outAt) {
  if (!inAt || !outAt) return '—';
  try {
    const ms = new Date(String(outAt).replace(' ', 'T') + 'Z') - new Date(String(inAt).replace(' ', 'T') + 'Z');
    if (ms < 0) return '—';
    const mins = Math.floor(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  } catch {
    return '—';
  }
}

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [students, setStudents] = useState([]);
  const [tab, setTab] = useState('list');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [excuseFor, setExcuseFor] = useState(null);
  const [excuseReason, setExcuseReason] = useState('');

  async function load() {
    try {
      const [ev, att, studs] = await Promise.all([api.getEvent(id), api.getEventAttendance(id), api.getStudents()]);
      setEvent(ev);
      setAttendance(att);
      setStudents(studs);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const attendedByStudent = useMemo(() => {
    const m = {};
    for (const a of attendance) m[a.studentId] = a;
    return m;
  }, [attendance]);

  async function applyStatus(student, status, note = '') {
    try {
      const existing = attendedByStudent[student.id];
      const payloadNote = status === 'excused' ? note : '';
      if (existing && existing.id) {
        if (status === 'none') {
          await api.deleteAttendance(existing.id);
        } else {
          await api.updateAttendance(existing.id, { status, note: payloadNote });
        }
      } else if (status !== 'none') {
        await api.manualAttendance({ eventId: Number(id), studentId: student.id, status, note: payloadNote });
      }
      await load();
      flash(`${student.firstName} ${student.lastName} · ${status === 'none' ? 'cleared' : status}`);
    } catch (e) {
      alert(e.message);
    }
  }

  function setStatus(student, status) {
    if (status === 'excused') {
      setExcuseReason('');
      setExcuseFor(student);
      return;
    }
    applyStatus(student, status);
  }

  function confirmExcuse() {
    const reason = excuseReason.trim();
    if (!reason) return;
    const student = excuseFor;
    setExcuseFor(null);
    applyStatus(student, 'excused', reason);
  }

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }

  async function exportPdf() {
    try {
      const { exportEventPdf } = await import('../pdf.js');
      exportEventPdf(event, attendance, event.reportSummary);
    } catch (e) {
      alert(e.message);
    }
  }

  async function closeEvent() {
    if (!confirm(`Close "${event.name}" and consolidate attendance?\n\nEvery student without a check-in will be marked absent and the final report will be locked.`)) return;
    setBusy(true);
    try {
      const updated = await api.closeEvent(id);
      setEvent(updated);
      flash('Event closed · attendance consolidated');
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reopenEvent() {
    if (!confirm('Reopen this event? Auto-generated absents will be cleared so students can check in again.')) return;
    setBusy(true);
    try {
      const updated = await api.reopenEvent(id);
      setEvent(updated);
      flash('Event reopened');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!event) return <div className="card"><Spinner label="Loading event…" size="lg" variant="panel" /></div>;

  const attendedCount = attendance.filter((a) => ATTENDED.includes(a.classification)).length;
  const rate = event.totalStudents ? Math.round((attendedCount / event.totalStudents) * 100) : 0;
  const phase = phaseOf(event);
  const phaseMeta = EVENT_PHASES[phase] || EVENT_PHASES.active;
  const filteredStudents = students.filter((s) => {
    const q = search.toLowerCase();
    return (
      !q ||
      s.firstName.toLowerCase().includes(q) ||
      s.lastName.toLowerCase().includes(q) ||
      s.studentNo.toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/events" className="link back">← Events</Link>
          <h2>
            {event.name}
            <span className={`pill ${phaseMeta.pill}`} style={{ marginLeft: '0.6rem', verticalAlign: 'middle' }}>
              {phaseMeta.label}
            </span>
          </h2>
          <p className="muted">
            {event.eventDate}
            {event.startTime ? ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : ''}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        <div className="head-actions">
          {event.status === 'active' ? (
            <>
              <Link className="btn btn-primary" to={`/events/${id}/scan`}>Scan QR</Link>
              <button className="btn" onClick={() => setShowQr(true)}>Check-in QR</button>
              <button className="btn btn-danger" onClick={closeEvent} disabled={busy}>
                {busy ? 'Closing…' : 'Close Event'}
              </button>
            </>
          ) : (
            <button className="btn" onClick={reopenEvent} disabled={busy}>
              {busy ? 'Reopening…' : 'Reopen Event'}
            </button>
          )}
          <button className="btn" onClick={() => exportCsv('event', id)}>Export CSV</button>
          <button className="btn" onClick={exportPdf}>Export PDF</button>
        </div>
      </div>

      {event.status !== 'active' ? (
        <div className="alert alert-info">
          This event is closed — check-in is turned off and attendance has been consolidated.
        </div>
      ) : phase === 'upcoming' ? (
        <div className="alert alert-info">
          This event is coming soon — it starts{event.startTime ? ` at ${event.startTime}` : ''} on {event.eventDate}.
          Check-ins made before it starts are recorded as <strong>Early</strong>.
        </div>
      ) : null}

      {event.reportSummary && (
        <div className="card consolidate-card">
          <div className="card-head">
            <h3>Consolidated Attendance</h3>
            <span className="muted small">
              Closed {event.closedAt ? new Date(String(event.closedAt).replace(' ', 'T') + 'Z').toLocaleString() : ''}
            </span>
          </div>
          <div className="consolidate-grid">
            <ConsolidateStat label="Attended" value={event.reportSummary.attended} />
            <ConsolidateStat label="Early" value={event.reportSummary.early} />
            <ConsolidateStat label="On-time" value={event.reportSummary.onTime} />
            <ConsolidateStat label="Late" value={event.reportSummary.late} />
            <ConsolidateStat label="Excused" value={event.reportSummary.excused} />
            <ConsolidateStat label="Absent" value={event.reportSummary.absent} />
            <ConsolidateStat label="Rate" value={`${event.reportSummary.rate}%`} />
          </div>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card accent-blue">
          <div className="stat-value">{attendedCount}</div>
          <div className="stat-label">Checked in</div>
        </div>
        <div className="stat-card accent-purple">
          <div className="stat-value">{event.totalStudents}</div>
          <div className="stat-label">Total students</div>
        </div>
        <div className="stat-card accent-green">
          <div className="stat-value">{rate}%</div>
          <div className="stat-label">Attendance rate</div>
        </div>
        <div className="stat-card accent-amber">
          <div className="stat-value" style={{ textTransform: 'capitalize' }}>{event.status}</div>
          <div className="stat-label">Check-in status</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>Attendance ({attendedCount}/{attendance.length})</button>
        <button className={tab === 'mark' ? 'active' : ''} onClick={() => setTab('mark')}>Mark Attendance</button>
      </div>

      {tab === 'list' && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Student No</th>
                <th>Name</th>
                <th>Status</th>
                <th>Method</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th>Duration</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attendance.length === 0 && (
                <tr><td colSpan={8} className="muted center">No students yet.</td></tr>
              )}
              {attendance.map((a) => (
                <tr key={a.id ?? `s${a.studentId}`}>
                  <td className="mono">{a.studentNo}</td>
                  <td className="strong">{a.lastName}, {a.firstName}</td>
                  <td>
                    {a.classification ? (
                      <span className={`pill ${statusClass[a.classification] || 'pill-gray'}`}>
                        {statusLabel[a.classification] || a.classification}
                      </span>
                    ) : (
                      <span className="muted small">Pending</span>
                    )}
                    {a.classification === 'excused' && a.note && (
                      <div className="muted small" style={{ marginTop: '0.2rem' }}>{a.note}</div>
                    )}
                  </td>
                  <td className="muted">{a.method || '—'}</td>
                  <td className="muted small">{fmtTime(a.checkedInAt)}</td>
                  <td className="muted small">
                    {a.checkedOutAt ? fmtTime(a.checkedOutAt) : a.checkedInAt ? <span className="pill pill-amber">On site</span> : '—'}
                  </td>
                  <td className="muted small">{duration(a.checkedInAt, a.checkedOutAt)}</td>
                  <td className="right">
                    {a.id ? (
                      <div className="seg seg-sm">
                        {ALL_STATUSES.map((st) => (
                          <button
                            key={st}
                            className={`seg-btn ${a.classification === st ? 'active' : ''}`}
                            onClick={() => setStatus({ id: a.studentId, firstName: a.firstName, lastName: a.lastName }, st)}
                            title={statusLabel[st] || st}
                          >
                            {statusShort[st] || st[0].toUpperCase()}
                          </button>
                        ))}
                        <button className="seg-btn" onClick={() => setStatus({ id: a.studentId }, 'none')} title="Clear">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'mark' && (
        <>
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search students…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>Student No</th>
                  <th>Name</th>
                  <th>Course</th>
                  <th className="right">Set Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => {
                  const current = attendedByStudent[s.id]?.status;
                  return (
                    <tr key={s.id}>
                      <td className="mono">{s.studentNo}</td>
                      <td className="strong">{s.lastName}, {s.firstName}</td>
                      <td>{s.course || '—'}</td>
                      <td className="right">
                    <div className="seg">
                      {ALL_STATUSES.map((st) => (
                        <button
                          key={st}
                          className={`seg-btn ${current === st ? 'active' : ''}`}
                          onClick={() => setStatus(s, st)}
                        >
                          {statusShort[st] || st[0].toUpperCase()}
                        </button>
                      ))}
                      <button
                        className={`seg-btn ${!current ? 'active' : ''}`}
                        onClick={() => setStatus(s, 'none')}
                        title="Clear"
                      >
                        ✕
                      </button>
                    </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showQr && <EventQrModal event={event} onClose={() => setShowQr(false)} />}
      {excuseFor && (
        <Modal
          title={`Mark excused — ${excuseFor.firstName || ''} ${excuseFor.lastName || ''}`.trim()}
          onClose={() => setExcuseFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setExcuseFor(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmExcuse} disabled={!excuseReason.trim()}>
                Mark excused
              </button>
            </>
          }
        >
          <form className="form" onSubmit={(e) => { e.preventDefault(); confirmExcuse(); }}>
            <label>
              Reason
              <textarea
                value={excuseReason}
                onChange={(e) => setExcuseReason(e.target.value)}
                rows={3}
                placeholder="e.g. Medical certificate, official school activity…"
                autoFocus
              />
            </label>
            <p className="muted small">The reason is stored on the record and included in exports.</p>
          </form>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ConsolidateStat({ label, value }) {
  return (
    <div className="consolidate-stat">
      <div className="consolidate-value">{value}</div>
      <div className="consolidate-label">{label}</div>
    </div>
  );
}

function EventQrModal({ event, onClose }) {
  const url = `${window.location.origin}/checkin/${event.checkinCode}`;
  return (
    <Modal
      title="Event Check-in QR"
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={() => window.print()}>Print</button>}
    >
      <div className="qr-display">
        <QRCodeCanvas value={url} size={220} level="M" includeMargin />
        <div className="qr-name">{event.name}</div>
        <div className="muted small">Students scan to open the check-in page.</div>
      </div>
      <p className="center">
        <span className="mono code-box">{event.checkinCode}</span>
      </p>
      <p className="muted small center">Or share this code: students visit the check-in page and enter their student number.</p>
    </Modal>
  );
}
