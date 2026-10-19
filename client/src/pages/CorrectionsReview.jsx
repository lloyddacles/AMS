import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

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

const REQUEST_PILL = { pending: 'pill-amber', approved: 'pill-green', rejected: 'pill-red' };

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

function fmt(sqliteUtc) {
  if (!sqliteUtc) return '—';
  return new Date(String(sqliteUtc).replace(' ', 'T') + 'Z').toLocaleString();
}

export default function CorrectionsReview() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, all: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [reviewing, setReviewing] = useState(null); // { row, action: 'approve' | 'reject' }
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load(activeTab = tab) {
    setLoading(true);
    try {
      const res = await api.getCorrections(activeTab);
      setRows(res.rows);
      setCounts(res.counts);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function flash(message) {
    setToast(message);
    setTimeout(() => setToast(''), 3500);
  }

  function openReview(row, action) {
    setReviewing({ row, action });
    setNote('');
    setNoteError('');
  }

  async function submitReview(e) {
    e.preventDefault();
    const action = reviewing.action;
    if (action === 'reject' && !note.trim()) {
      setNoteError('A note is required when rejecting a request');
      return;
    }
    setSaving(true);
    setNoteError('');
    try {
      if (action === 'approve') {
        const res = await api.approveCorrection(reviewing.row.id, note.trim() || undefined);
        flash(
          res.summary
            ? `Correction approved · report now ${res.summary.attended}/${res.summary.totalStudents} (${res.summary.rate}%)`
            : 'Correction approved'
        );
      } else {
        await api.rejectCorrection(reviewing.row.id, note.trim());
        flash('Correction rejected');
      }
      setReviewing(null);
      await load(tab);
    } catch (err) {
      setNoteError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Correction Requests</h2>
          <p className="muted">Students submit these themselves. Approving applies the change to attendance.</p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label} <span className="tab-count">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {loading && rows.length === 0 && (
        <div className="card"><Spinner label="Loading requests…" size="lg" variant="panel" /></div>
      )}

      {!loading && rows.length === 0 && (
        <div className="empty card">
          <p>{tab === 'pending' ? 'No pending correction requests.' : `No ${tab} requests.`}</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Event</th>
                <th>Current</th>
                <th>Requested</th>
                <th>Reason</th>
                <th>Submitted</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="strong">{r.lastName}, {r.firstName}</div>
                    <div className="muted small mono">{r.studentNo}</div>
                  </td>
                  <td>
                    <div>{r.eventName}</div>
                    <div className="muted small">{r.eventDate}{r.eventStatus === 'closed' ? ' · closed' : ''}</div>
                  </td>
                  <td>
                    <span className={`pill ${STATUS_PILL[r.classification] || 'pill-blue'}`}>
                      {r.classification ? STATUS_LABEL[r.classification] || r.classification : 'Not marked'}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${STATUS_PILL[r.requestedStatus] || 'pill-blue'}`}>
                      {STATUS_LABEL[r.requestedStatus] || r.requestedStatus}
                    </span>
                  </td>
                  <td style={{ maxWidth: '18rem' }}>
                    <div className="small">{r.reason}</div>
                    {r.status !== 'pending' && r.resolutionNote && (
                      <div className="muted small">Note: {r.resolutionNote}</div>
                    )}
                    {r.status !== 'pending' && (
                      <div className="muted small">
                        by {r.reviewedByName || '—'} · {fmt(r.reviewedAt)}
                      </div>
                    )}
                  </td>
                  <td className="muted small">{fmt(r.createdAt)}</td>
                  <td className="right actions">
                    {r.status === 'pending' ? (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => openReview(r, 'approve')}>
                          Approve
                        </button>{' '}
                        <button className="btn btn-sm btn-danger" onClick={() => openReview(r, 'reject')}>
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className={`pill ${REQUEST_PILL[r.status] || 'pill-amber'}`}>{r.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewing && (
        <Modal
          title={
            reviewing.action === 'approve'
              ? `Approve correction — ${reviewing.row.lastName}, ${reviewing.row.firstName}`
              : `Reject correction — ${reviewing.row.lastName}, ${reviewing.row.firstName}`
          }
          onClose={() => setReviewing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setReviewing(null)}>Cancel</button>
              <button
                className={`btn ${reviewing.action === 'approve' ? 'btn-primary' : 'btn-danger'}`}
                form="review-form"
                disabled={saving}
              >
                {saving ? 'Saving…' : reviewing.action === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </>
          }
        >
          <form className="form" id="review-form" onSubmit={submitReview}>
            <p className="muted small">
              {reviewing.row.eventName} · wanted{' '}
              <span className={`pill ${STATUS_PILL[reviewing.row.requestedStatus] || 'pill-blue'}`}>
                {STATUS_LABEL[reviewing.row.requestedStatus] || reviewing.row.requestedStatus}
              </span>
              {' '}— current{' '}
              <span className={`pill ${STATUS_PILL[reviewing.row.classification] || 'pill-blue'}`}>
                {reviewing.row.classification ? STATUS_LABEL[reviewing.row.classification] || reviewing.row.classification : 'Not marked'}
              </span>
            </p>
            {reviewing.action === 'approve' ? (
              <p className="muted small">
                Approving sets this student's status to{' '}
                <strong>{STATUS_LABEL[reviewing.row.requestedStatus] || reviewing.row.requestedStatus}</strong> for this event.
                {reviewing.row.eventStatus === 'closed' && ' The event is closed — its final report will be refreshed.'}
              </p>
            ) : (
              <p className="muted small">The request keeps its status but the student will see your note.</p>
            )}
            <label>
              Note {reviewing.action === 'reject' ? '*' : '(optional)'}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder={reviewing.action === 'reject' ? 'Why is this request not being granted?' : 'Anything worth recording about this decision'}
              />
            </label>
            {noteError && <div className="alert alert-error">{noteError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
