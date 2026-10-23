import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Spinner from '../../components/Spinner.jsx';
import Modal from '../../components/Modal.jsx';

const PAGE_SIZE = 25;
const REQUESTABLE = ['early', 'on-time', 'present', 'late', 'excused'];

const STATUS_PILL = {
  early: 'pill-cyan',
  'on-time': 'pill-green',
  present: 'pill-blue',
  late: 'pill-amber',
  excused: 'pill-purple',
  absent: 'pill-red',
  pending: 'pill-amber',
  excluded: 'pill-gray',
};
const STATUS_LABEL = {
  early: 'Early',
  'on-time': 'On-time',
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
  pending: 'Pending',
  excluded: 'Off list',
};
const CORR_PILL = { pending: 'pill-amber', approved: 'pill-green', rejected: 'pill-red' };
const CORR_LABEL = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

const fmtTime = (v) =>
  v
    ? new Date(String(v).replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—';

export default function PortalHistory() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [want, setWant] = useState('on-time');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.studentTerms().then(setTerms).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (term) params.termId = term;
    if (q) params.q = q;
    api
      .studentAttendance(params)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
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
  }, [page, term, q]);

  function flash(message) {
    setToast(message);
    setTimeout(() => setToast(''), 3000);
  }

  function applySearch(e) {
    e.preventDefault();
    setPage(0);
    setQ(search.trim());
  }

  function openRequest(row) {
    setModal(row);
    setWant('on-time');
    setReason('');
    setFormError('');
  }

  async function sendRequest(e) {
    e.preventDefault();
    const text = reason.trim();
    if (text.length < 3) {
      setFormError('Please give a short reason (at least 3 characters).');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await api.studentCreateCorrection({ eventId: modal.eventId, requestedStatus: want, reason: text });
      setModal(null);
      flash('Correction request sent for review.');
      setPage(0);
      const params = { limit: PAGE_SIZE, offset: 0 };
      if (term) params.termId = term;
      if (q) params.q = q;
      const res = await api.studentAttendance(params);
      setRows(res.rows);
      setTotal(res.total);
      setCounts(res.counts);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="portal-page">
      <div className="page-head">
        <div>
          <h2>Attendance history</h2>
          <p className="muted">Every recorded event, including archived ones.</p>
        </div>
      </div>

      <form className="portal-filters" onSubmit={applySearch}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search event or location…"
        />
        <select
          value={term}
          onChange={(e) => {
            setPage(0);
            setTerm(e.target.value);
          }}
        >
          <option value="">All terms</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" type="submit">
          Search
        </button>
        {(q || term) && (
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setSearch('');
              setQ('');
              setTerm('');
              setPage(0);
            }}
          >
            Clear
          </button>
        )}
      </form>

      {counts && (
        <div className="portal-chips">
          {[
            ['Early', counts.early, 'pill-cyan'],
            ['On-time', counts.onTime, 'pill-green'],
            ['Late', counts.late, 'pill-amber'],
            ['Absent', counts.absent, 'pill-red'],
            ['Excused', counts.excused, 'pill-purple'],
            ['Pending', counts.pending, 'pill-amber'],
            ['Off list', counts.excluded, 'pill-gray'],
          ].map(([label, value, cls]) => (
            <span key={label} className={`pill ${cls}`}>
              {label} · {value}
            </span>
          ))}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card table-card">
        {loading ? (
          <div style={{ padding: '1rem' }}>
            <Spinner label="Loading history…" size="lg" variant="panel" />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p className="muted">No events match your filters.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Event</th>
                <th>Status</th>
                <th>Time in</th>
                <th>Correction</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.eventId}>
                  <td>
                    {r.eventDate}
                    {r.startTime ? <div className="muted">{r.startTime}</div> : null}
                  </td>
                  <td>
                    <strong>{r.name}</strong>
                    {r.archived ? <span className="pill pill-gray">Archived</span> : null}
                    {r.seriesId && r.seriesDays > 1 && <span className="pill pill-blue">Series · {r.seriesDays} days</span>}
                    {r.location ? <div className="muted">{r.location}</div> : null}
                  </td>
                  <td>
                    <span className={`pill ${STATUS_PILL[r.status] || 'pill-gray'}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td>{fmtTime(r.checkedInAt)}</td>
                  <td>
                    {r.correction ? (
                      <span className={`pill ${CORR_PILL[r.correction.status] || 'pill-gray'}`}>
                        {CORR_LABEL[r.correction.status] || r.correction.status}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {r.canRequest ? (
                      <button className="btn btn-sm" onClick={() => openRequest(r)}>
                        Request correction
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="pager">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Previous
          </button>
          <span className="muted">
            {from}–{to} of {total}
          </span>
          <button className="btn btn-sm" disabled={to >= total} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}

      {modal && (
        <Modal
          title="Request a correction"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" form="portal-corr-form" disabled={busy}>
                {busy ? 'Sending…' : 'Send request'}
              </button>
            </>
          }
        >
          <form id="portal-corr-form" className="form" onSubmit={sendRequest}>
            <p className="muted">
              {modal.name} · {modal.eventDate} · currently{' '}
              <span className={`pill ${STATUS_PILL[modal.status] || 'pill-gray'}`}>
                {STATUS_LABEL[modal.status] || modal.status}
              </span>
            </p>
            <label>
              Correct status
              <select value={want} onChange={(e) => setWant(e.target.value)}>
                {REQUESTABLE.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s] || s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="What happened? Staff will review your request."
                required
              />
            </label>
            {formError && <div className="alert alert-error">{formError}</div>}
          </form>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
