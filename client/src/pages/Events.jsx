import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { phaseOf, EVENT_PHASES } from '../eventStatus.js';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyForm = {
  name: '',
  description: '',
  location: '',
  eventDate: '',
  startTime: '',
  endTime: '',
  status: 'active',
  requireStudentConfirm: false,
  autoConfirm: false,
  termId: '',
};

export default function Events() {
  const [events, setEvents] = useState([]);
  const [archivedEvents, setArchivedEvents] = useState([]);
  const [view, setView] = useState('events');
  const [terms, setTerms] = useState([]);
  const [termFilter, setTermFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [evs, archs, tms] = await Promise.all([
        api.getEvents(),
        api.getEvents(undefined, { archived: 1 }),
        api.getTerms(),
      ]);
      setEvents(evs);
      setArchivedEvents(archs);
      setTerms(tms);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing({});
    setView('events');
    const current = terms.find((t) => Number(t.isCurrent) === 1);
    setForm({ ...emptyForm, termId: current ? String(current.id) : '' });
    setFormError('');
  }

  function openEdit(ev) {
    setEditing(ev);
    setForm({
      name: ev.name,
      description: ev.description || '',
      location: ev.location || '',
      eventDate: ev.eventDate,
      startTime: ev.startTime || '',
      endTime: ev.endTime || '',
      status: ev.status,
      requireStudentConfirm: !!ev.requireStudentConfirm,
      autoConfirm: !!ev.autoConfirm,
      termId: ev.termId ? String(ev.termId) : '',
    });
    setFormError('');
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = { ...form, termId: form.termId ? Number(form.termId) : null };
      if (editing?.id) await api.updateEvent(editing.id, payload);
      else await api.createEvent(payload);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(ev) {
    if (!confirm(`Delete event "${ev.name}"? Attendance records for it will also be removed.`)) return;
    try {
      await api.deleteEvent(ev.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function archive(ev) {
    if (!confirm(`Archive "${ev.name}"?\n\nIt moves to the Archived section. Attendance and reports keep it.`)) return;
    try {
      await api.archiveEvent(ev.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function unarchive(ev) {
    try {
      await api.unarchiveEvent(ev.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  const list = view === 'archived' ? archivedEvents : events;
  const visible = termFilter ? list.filter((e) => String(e.termId) === termFilter) : list;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>{view === 'archived' ? 'Archived Events' : 'Events'}</h2>
          <p className="muted">
            {visible.length} event{visible.length === 1 ? '' : 's'}
            {termFilter ? ` in ${terms.find((t) => String(t.id) === termFilter)?.name || 'term'}` : ''}
            {view === 'archived' ? ' · closed and filed away' : ''}
          </p>
        </div>
        <div className="head-actions">
          {terms.length > 0 && (
            <select className="term-filter" value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
              <option value="">All terms</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={openCreate}>+ Add Event</button>
        </div>
      </div>

      <div className="tabs">
        <button className={view === 'events' ? 'active' : ''} onClick={() => setView('events')}>
          Events <span className="tab-count">{events.length}</span>
        </button>
        <button className={view === 'archived' ? 'active' : ''} onClick={() => setView('archived')}>
          Archived <span className="tab-count">{archivedEvents.length}</span>
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="card"><Spinner label="Loading events…" size="lg" variant="panel" /></div>}

      {!loading && visible.length === 0 && view === 'events' && (
        <div className="empty card">
          <h3>No events{termFilter ? ' for this term' : ' yet'}</h3>
          <p className="muted">Create an event, or set up a recurring schedule to generate them automatically.</p>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Event</button>
        </div>
      )}

      {!loading && visible.length === 0 && view === 'archived' && (
        <div className="empty card">
          <h3>Nothing archived{termFilter ? ' for this term' : ''}</h3>
          <p className="muted">Close an event, then archive it to keep the main list tidy. Archived events keep their attendance and still appear in reports.</p>
          <button className="btn" onClick={() => setView('events')}>Back to events</button>
        </div>
      )}

      <div className="event-grid">
        {visible.map((ev) => {
          const rate = ev.totalStudents ? Math.round((ev.attendanceCount / ev.totalStudents) * 100) : 0;
          const phase = phaseOf(ev);
          const phaseMeta = EVENT_PHASES[phase] || EVENT_PHASES.active;
          const isArchived = view === 'archived';
          return (
            <div key={ev.id} className={`card event-card${isArchived ? ' archived' : ''}`}>
              <div className="event-card-top">
                {isArchived ? (
                  <span className="pill pill-gray">Archived</span>
                ) : (
                  <span className={`pill ${phaseMeta.pill}`}>{phaseMeta.label}</span>
                )}
                <span className="muted small">{ev.eventDate}{ev.startTime ? ` · ${ev.startTime}` : ''}</span>
              </div>
              <h3>{ev.name}</h3>
              <p className="muted small clamp">{ev.description || 'No description'}</p>
              <p className="muted small">📍 {ev.location || 'Location TBD'}</p>
              <p className="small">
                {ev.scheduleId ? (
                  <span className="pill pill-cyan">↻ Recurring</span>
                ) : (
                  <span className="pill pill-gray">One-off</span>
                )}
                {ev.termName && <span className="pill pill-purple" style={{ marginLeft: '0.35rem' }}>{ev.termName}</span>}
                {ev.requireStudentConfirm && <span className="pill pill-blue" style={{ marginLeft: '0.35rem' }}>Kiosk · ID</span>}
                {ev.seriesId && Number(ev.seriesDayCount) > 0 && (
                  <span className="pill pill-blue" style={{ marginLeft: '0.35rem' }}>
                    {ev.seriesName || 'Series'} · {ev.seriesDayCount} day{Number(ev.seriesDayCount) === 1 ? '' : 's'}
                  </span>
                )}
              </p>
              <div className="rate-wrap">
                <div className="rate-bar"><span style={{ width: `${rate}%` }} /></div>
                <span className="rate-label">{ev.attendanceCount}/{ev.totalStudents}</span>
              </div>
              <div className="event-card-actions">
                {isArchived ? (
                  <>
                    <Link className="btn btn-sm" to={`/events/${ev.id}`}>Open</Link>
                    <button className="btn btn-sm" onClick={() => unarchive(ev)}>Unarchive</button>
                    <button className="btn btn-sm" onClick={() => openEdit(ev)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(ev)}>Delete</button>
                  </>
                ) : (
                  <>
                    {phase === 'active' && (
                      <Link className="btn btn-sm btn-primary" to={`/events/${ev.id}/scan`}>Scan</Link>
                    )}
                    <Link className={`btn btn-sm ${phase === 'active' ? '' : 'btn-primary'}`} to={`/events/${ev.id}`}>Open</Link>
                    <button className="btn btn-sm" onClick={() => openEdit(ev)}>Edit</button>
                    {ev.status === 'closed' && (
                      <button className="btn btn-sm" onClick={() => archive(ev)} title="Move to the Archived section">Archive</button>
                    )}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(ev)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Edit Event' : 'Add Event'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <form className="form grid-form" onSubmit={save}>
            <label className="span-2">
              Event Name *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="span-2">
              Description
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label>
              Date *
              <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} required />
            </label>
            <label>
              Location
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <label>
              Start Time
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </label>
            <label>
              End Time
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">active (check-in open)</option>
                <option value="closed">closed (check-in closed)</option>
              </select>
            </label>
            <label>
              Term
              <select value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })}>
                <option value="">— none —</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>
                ))}
              </select>
            </label>
            <label className="checkbox span-2">
              <input
                type="checkbox"
                checked={form.requireStudentConfirm}
                onChange={(e) => setForm({ ...form, requireStudentConfirm: e.target.checked })}
              />
              <span>Require student number confirmation when scanning (anti-sharing / kiosk mode)</span>
            </label>
            <label className="checkbox span-2">
              <input
                type="checkbox"
                checked={form.autoConfirm}
                disabled={form.requireStudentConfirm}
                onChange={(e) => setForm({ ...form, autoConfirm: e.target.checked })}
              />
              <span>
                Auto-confirm scans (staff is monitoring — each matched scan is saved without clicking Confirm)
                {form.requireStudentConfirm && ' · not available in kiosk mode'}
              </span>
            </label>
            {formError && <div className="alert alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
