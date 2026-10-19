import { useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import LiveClock from '../components/LiveClock.jsx';
import Footer from '../components/Footer.jsx';

const STATUS_PILL = {
  early: 'pill-cyan',
  'on-time': 'pill-green',
  present: 'pill-blue',
  late: 'pill-amber',
  excused: 'pill-purple',
  absent: 'pill-red',
};

const STATUS_LABEL = {
  early: 'Early',
  'on-time': 'On-time',
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
};

const REQUESTABLE = ['early', 'on-time', 'present', 'late', 'excused'];

const REQUEST_PILL = { pending: 'pill-amber', approved: 'pill-green', rejected: 'pill-red' };

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export default function Corrections() {
  const [studentNo, setStudentNo] = useState('');
  const [name, setName] = useState('');
  const [creds, setCreds] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [selecting, setSelecting] = useState(null);
  const [wantStatus, setWantStatus] = useState('on-time');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');

  async function lookup(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.correctionLookup(studentNo, name);
      setCreds({ studentNo: studentNo.trim(), name: name.trim() });
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startRequest(rec) {
    setSelecting(rec);
    setWantStatus('on-time');
    setReason('');
    setFormError('');
  }

  async function submitRequest(e) {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      await api.createCorrection({
        eventId: selecting.eventId,
        studentNo: creds.studentNo,
        name: creds.name,
        requestedStatus: wantStatus,
        reason,
      });
      setSelecting(null);
      setToast('Request submitted — staff will review it shortly.');
      setTimeout(() => setToast(''), 4000);
      const refreshed = await api.correctionLookup(creds.studentNo, creds.name);
      setData(refreshed);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setData(null);
    setCreds(null);
    setStudentNo('');
    setName('');
    setError('');
  }

  if (!data) {
    return (
      <div className="public-page">
        <div className="login-card">
          <LiveClock className="public-clock" />
          <div className="login-brand">
            <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
            <h1>Attendance Corrections</h1>
            <p className="muted">Spotted a wrong or missing check-in? Look yourself up and send a correction request.</p>
          </div>
          <form className="form" onSubmit={lookup}>
            <label>
              Student Number
              <input
                value={studentNo}
                onChange={(e) => setStudentNo(e.target.value)}
                placeholder="e.g. 2024-0001"
                autoFocus
                required
              />
            </label>
            <label>
              Full Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As registered, e.g. Juan Dela Cruz"
                required
              />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Looking up…' : 'Find My Records'}
            </button>
          </form>
        </div>
        <Footer compact />
      </div>
    );
  }

  const { student, records } = data;

  return (
    <div className="public-page">
      <div className="login-card wide-card">
        <div className="login-brand">
          <span className="brand-mark lg"><img src="/logo.png" alt="AttendX logo" /></span>
          <h1>My Attendance</h1>
          <p className="strong">{student.lastName}, {student.firstName}</p>
          <p className="muted small">
            {student.studentNo}{student.course ? ` · ${student.course}` : ''}{student.yearLevel ? ` · Year ${student.yearLevel}` : ''}{student.section ? ` · ${student.section}` : ''}
          </p>
        </div>

        {records.length === 0 && <p className="muted">No events found for you yet.</p>}

        <ul className="list" style={{ maxHeight: '24rem', overflow: 'auto', width: '100%' }}>
          {records.map((r) => (
            <li key={r.eventId} className="list-row" style={{ padding: '0.6rem 0' }}>
              <div style={{ minWidth: 0 }}>
                <div className="strong">{r.name}</div>
                <div className="muted small">
                  {fmtDate(r.eventDate)}{r.startTime ? ` · ${r.startTime}` : ''}{r.closedAt ? ' · closed' : ''}
                </div>
                {!r.onList && <div className="muted small">Not on the attendee list for this event</div>}
                {r.correction && (
                  <div className="muted small">
                    Request: {STATUS_LABEL[r.correction.requestedStatus] || r.correction.requestedStatus} wanted
                    {r.correction.status !== 'pending' && r.correction.resolutionNote ? ` — “${r.correction.resolutionNote}”` : ''}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                {r.correction && (
                  <span className={`pill ${REQUEST_PILL[r.correction.status] || 'pill-amber'}`}>{r.correction.status}</span>
                )}
                <span className={`pill ${STATUS_PILL[r.classification] || 'pill-blue'}`}>
                  {r.classification ? STATUS_LABEL[r.classification] || r.classification : 'Not marked'}
                </span>
                {r.canRequest && (
                  <button className="btn btn-sm" onClick={() => startRequest(r)}>Request correction</button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <button className="btn btn-ghost btn-block" onClick={reset}>Look up another student</button>
      </div>

      {selecting && (
        <Modal
          title={`Request correction — ${selecting.name}`}
          onClose={() => setSelecting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSelecting(null)}>Cancel</button>
              <button className="btn btn-primary" form="correction-form" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </>
          }
        >
          <form className="form" id="correction-form" onSubmit={submitRequest}>
            <p className="muted small">
              Current status:{' '}
              <span className={`pill ${STATUS_PILL[selecting.classification] || 'pill-blue'}`}>
                {selecting.classification ? STATUS_LABEL[selecting.classification] || selecting.classification : 'Not marked'}
              </span>
            </p>
            <label>
              What should your status be? *
              <select value={wantStatus} onChange={(e) => setWantStatus(e.target.value)}>
                {REQUESTABLE.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label>
              Why is this correction needed? *
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="e.g. I attended the whole session but my QR was not scanned."
                required
              />
            </label>
            {formError && <div className="alert alert-error">{formError}</div>}
            <p className="muted small">Your request goes to the organizers for review. Nothing changes until it is approved.</p>
          </form>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
      <Footer compact />
    </div>
  );
}
