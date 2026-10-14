import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { api, exportCsv } from '../api.js';
import Modal from '../components/Modal.jsx';

const STATUSES = ['present', 'late', 'excused', 'absent'];
const statusClass = {
  early: 'pill-blue',
  'on-time': 'pill-green',
  present: 'pill-green',
  late: 'pill-amber',
  excused: 'pill-blue',
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

  async function setStatus(student, status) {
    try {
      const existing = attendedByStudent[student.id];
      if (existing && existing.id) {
        if (status === 'none') {
          await api.deleteAttendance(existing.id);
        } else {
          await api.updateAttendance(existing.id, { status });
        }
      } else if (status !== 'none') {
        await api.manualAttendance({ eventId: Number(id), studentId: student.id, status });
      }
      await load();
      flash(`${student.firstName} ${student.lastName} · ${status === 'none' ? 'cleared' : status}`);
    } catch (e) {
      alert(e.message);
    }
  }

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!event) return <div className="muted">Loading…</div>;

  const attendedCount = attendance.filter((a) => ATTENDED.includes(a.classification)).length;
  const rate = event.totalStudents ? Math.round((attendedCount / event.totalStudents) * 100) : 0;
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
          <h2>{event.name}</h2>
          <p className="muted">
            {event.eventDate}
            {event.startTime ? ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : ''}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-primary" to={`/events/${id}/scan`}>Scan QR</Link>
          <button className="btn" onClick={() => setShowQr(true)}>Check-in QR</button>
          <button className="btn" onClick={() => exportCsv('event', id)}>Export CSV</button>
        </div>
      </div>

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
                            onClick={() => setStatus({ id: a.studentId }, st)}
                            title={statusLabel[st] || st}
                          >
                            {statusLabel[st]?.[0] || st[0].toUpperCase()}
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
                          {statusLabel[st]?.[0] || st[0].toUpperCase()}
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
      {toast && <div className="toast">{toast}</div>}
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
