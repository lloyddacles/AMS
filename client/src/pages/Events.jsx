import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { phaseOf, EVENT_PHASES } from '../eventStatus.js';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
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

function formatEventTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(t);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function generateEventDescription(form) {
  const name = String(form?.name || '').trim();
  if (!name) return '';
  const location = String(form?.location || '').trim();
  const date = String(form?.eventDate || '').trim();
  const start = formatEventTime(form?.startTime);
  const end = formatEventTime(form?.endTime);
  const lower = name.toLowerCase();

  let purpose = 'attendance will be recorded for all expected participants';
  if (/assembly|flag|ceremony/.test(lower)) purpose = 'students are expected to attend and participate in the scheduled program';
  else if (/meeting|orientation|briefing|seminar|workshop|training/.test(lower)) purpose = 'participants are expected to attend for important updates and instructions';
  else if (/exam|test|quiz|assessment/.test(lower)) purpose = 'attendance will be monitored to ensure all participants are accounted for';
  else if (/class|lecture|lesson/.test(lower)) purpose = 'attendance and participation will be recorded for this session';
  else if (/practice|rehearsal|drill/.test(lower)) purpose = 'participants are required to attend for preparation and coordination';
  else if (/cleanup|outreach|activity|program|event|celebration/.test(lower)) purpose = 'participants are encouraged to attend and take part in the scheduled activities';

  const parts = [`${name} is scheduled`];
  if (date) parts.push(`on ${date}`);
  if (start && end) parts.push(`from ${start} to ${end}`);
  else if (start) parts.push(`starting at ${start}`);
  if (location) parts.push(`at ${location}`);

  const first = `${parts.join(' ')}.`;
  const second = `During this event, ${purpose}.`;
  const third = 'Please arrive on time, bring any required materials, and follow the instructions provided by the organizers or staff.';
  return [first, second, third].join(' ');
}

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
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const count = `${ids.length} event${ids.length === 1 ? '' : 's'}`;
    if (action === 'close' && !confirm(`Close ${count}?\n\nMissing students will be marked absent and the event summary locked.`)) return;
    if (action === 'reopen' && !confirm(`Reopen ${count}?\n\nAuto-recorded absences for those events will be cleared.`)) return;
    if (action === 'archive' && !confirm(`Archive ${count}?\n\nOnly closed events can be archived.`)) return;

    setBulkBusy(true);
    try {
      const res = await api.bulkEvents(ids, action);
      setSelected(new Set());
      await load();
      const skipped = res.skipped || [];
      let message = `${res.updated?.length || 0} event(s) updated.`;
      if (skipped.length) {
        message += `\n\nSkipped ${skipped.length}:\n` +
          skipped.slice(0, 8).map((s) => `• ${s.name}: ${s.reason}`).join('\n') +
          (skipped.length > 8 ? `\n…and ${skipped.length - 8} more` : '');
      }
      alert(message);
    } catch (e) {
      alert(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const list = view === 'archived' ? archivedEvents : events;
  const visible = termFilter ? list.filter((e) => String(e.termId) === termFilter) : list;
  const visibleIds = visible.map((e) => e.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  // Keep the selection limited to events that still exist, and clear it when
  // switching between the events and archived tabs.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set([...events, ...archivedEvents].map((e) => e.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [events, archivedEvents]);

  useEffect(() => {
    setSelected(new Set());
  }, [view]);

  function toggleSelectVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const activeCount = events.filter((e) => e.status === 'active').length;
  const recurringCount = events.filter((e) => e.scheduleId).length;
  const seriesCount = events.filter((e) => e.seriesId).length;

  return (
    <div className="page events-page">
      <PageHeader
        eyebrow="Attendance events"
        title={view === 'archived' ? 'Archived Events' : 'Events'}
        subtitle={
          `${visible.length} event${visible.length === 1 ? '' : 's'}`
          + (termFilter ? ` in ${terms.find((t) => String(t.id) === termFilter)?.name || 'term'}` : '')
          + (view === 'archived' ? ' · closed and filed away' : ' · manage schedules, check-ins, and attendance')
        }
        actions={<button className="btn btn-primary" onClick={openCreate}>+ Add Event</button>}
      />

      <div className="stat-grid">
        <StatCard icon="calendar" accent="blue" label="Total events" value={events.length} hint="In the main list" />
        <StatCard icon="live" accent="green" label="Active" value={activeCount} hint="Check-in open" />
        <StatCard icon="repeat" accent="purple" label="Recurring" value={recurringCount} hint="From schedules" />
        <StatCard icon="layers" accent="amber" label="Series" value={seriesCount} hint="Multi-day events" />
      </div>

      <div className="card events-controls">
        <div className="events-controls-main">
          <div className="tabs">
            <button className={view === 'events' ? 'active' : ''} onClick={() => setView('events')}>
              Events <span className="tab-count">{events.length}</span>
            </button>
            <button className={view === 'archived' ? 'active' : ''} onClick={() => setView('archived')}>
              Archived <span className="tab-count">{archivedEvents.length}</span>
            </button>
          </div>
          <div className="events-controls-right">
            {visible.length > 0 && (
              <label className="events-select-all">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} />
                <span>Select all shown</span>
              </label>
            )}
            {terms.length > 0 && (
              <label className="events-term-filter">
                <span className="events-filter-label">Term</span>
                <select className="term-filter" value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
                  <option value="">All terms</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        {selected.size > 0 && (
          <div className="events-bulk-bar">
            <div className="events-bulk-info">
              <span className="events-bulk-count">{selected.size}</span>
              <span>event{selected.size === 1 ? '' : 's'} selected</span>
            </div>
            <div className="events-bulk-actions">
              {view === 'archived' ? (
                <button className="btn btn-sm" onClick={() => runBulk('unarchive')} disabled={bulkBusy}>
                  {bulkBusy ? 'Working…' : 'Unarchive'}
                </button>
              ) : (
                <>
                  <button className="btn btn-sm btn-primary" onClick={() => runBulk('close')} disabled={bulkBusy}>
                    {bulkBusy ? 'Working…' : 'Close'}
                  </button>
                  <button className="btn btn-sm" onClick={() => runBulk('reopen')} disabled={bulkBusy}>Reopen</button>
                  <button className="btn btn-sm" onClick={() => runBulk('archive')} disabled={bulkBusy}>Archive</button>
                </>
              )}
              <button className="btn btn-sm btn-ghost-light" onClick={() => setSelected(new Set())} disabled={bulkBusy}>Clear</button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="card"><Spinner label="Loading events…" size="lg" variant="panel" /></div>}

      {!loading && visible.length === 0 && view === 'events' && (
        <div className="empty card events-empty">
          <div className="events-empty-icon">★</div>
          <h3>No events{termFilter ? ' for this term' : ' yet'}</h3>
          <p className="muted">Create an event, or set up a recurring schedule to generate them automatically.</p>
          <button className="btn btn-primary" onClick={openCreate}>+ Create your first event</button>
        </div>
      )}

      {!loading && visible.length === 0 && view === 'archived' && (
        <div className="empty card events-empty">
          <div className="events-empty-icon">⭳</div>
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
          const checked = selected.has(ev.id);
          return (
            <div key={ev.id} className={`card event-card event-card-v2${isArchived ? ' archived' : ''}${checked ? ' is-selected' : ''}`}>
              <div className="event-card-top">
                <label className="event-select" title="Select event">
                  <input type="checkbox" checked={checked} onChange={() => toggleSelect(ev.id)} />
                </label>
                <div className="event-card-badges">
                  {isArchived ? (
                    <span className="pill pill-gray">Archived</span>
                  ) : (
                    <span className={`pill ${phaseMeta.pill}`}>{phaseMeta.label}</span>
                  )}
                  {ev.scheduleId ? <span className="pill pill-cyan">↻ Recurring</span> : <span className="pill pill-gray">One-off</span>}
                </div>
              </div>

              <div className="event-card-body">
                <h3 className="event-card-title">{ev.name}</h3>
                <p className="muted small clamp event-card-desc">{ev.description || 'No description provided.'}</p>
                <div className="event-meta-grid">
                  <div className="event-meta-item"><span className="event-meta-label">Date</span><span>{ev.eventDate}{ev.startTime ? ` · ${ev.startTime}` : ''}</span></div>
                  <div className="event-meta-item"><span className="event-meta-label">Location</span><span>{ev.location || 'Location TBD'}</span></div>
                </div>
                <div className="event-tag-row">
                  {ev.termName && <span className="pill pill-purple">{ev.termName}</span>}
                  {ev.requireStudentConfirm && <span className="pill pill-blue">Kiosk · ID</span>}
                  {ev.seriesId && Number(ev.seriesDayCount) > 0 && (
                    <span className="pill pill-blue">{ev.seriesName || 'Series'} · {ev.seriesDayCount} day{Number(ev.seriesDayCount) === 1 ? '' : 's'}</span>
                  )}
                </div>
                <div className="event-progress">
                  <div className="event-progress-head">
                    <span className="muted small">Attendance</span>
                    <span className="strong small">{ev.attendanceCount}/{ev.totalStudents} · {rate}%</span>
                  </div>
                  <div className="rate-wrap">
                    <div className="rate-bar"><span style={{ width: `${rate}%` }} /></div>
                  </div>
                </div>
              </div>

              <div className="event-card-actions event-card-actions-v2">
                {isArchived ? (
                  <>
                    <Link className="btn btn-sm btn-primary" to={`/events/${ev.id}`}>Open</Link>
                    <button className="btn btn-sm" onClick={() => unarchive(ev)}>Unarchive</button>
                    <button className="btn btn-sm" onClick={() => openEdit(ev)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(ev)}>Delete</button>
                  </>
                ) : (
                  <>
                    {phase === 'active' && <Link className="btn btn-sm btn-primary" to={`/events/${ev.id}/scan`}>Scan</Link>}
                    <Link className={`btn btn-sm ${phase === 'active' ? '' : 'btn-primary'}`} to={`/events/${ev.id}`}>Open</Link>
                    <button className="btn btn-sm" onClick={() => openEdit(ev)}>Edit</button>
                    {ev.status === 'closed' && <button className="btn btn-sm" onClick={() => archive(ev)} title="Move to the Archived section">Archive</button>}
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
          wide
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
          <form className="form event-form" onSubmit={save}>
            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Event details</h4>
                <p className="muted small">Basic information shown to staff and used for attendance records.</p>
              </div>
              <div className="form grid-form">
                <label className="span-2">
                  <span>Event Name <span className="req">*</span></span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Morning Assembly" required />
                </label>
                <label className="span-2">
                  <div className="event-label-row">
                    <span>Description</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setForm((f) => ({ ...f, description: generateEventDescription(f) }))}
                      disabled={!String(form.name || '').trim()}
                      title="Generate a description from the event details"
                    >
                      ✨ Generate description
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional notes or instructions for this event"
                  />
                  <span className="muted small">Tip: enter the event name first, then click Generate to draft a description.</span>
                </label>
                <label className="span-2">
                  <span>Location</span>
                  <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Main Hall, Room 101" />
                </label>
              </div>
            </section>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Schedule & status</h4>
                <p className="muted small">Set when the event happens and whether check-in is open.</p>
              </div>
              <div className="form grid-form">
                <label>
                  <span>Date <span className="req">*</span></span>
                  <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} required />
                </label>
                <label>
                  <span>Term</span>
                  <select value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })}>
                    <option value="">— none —</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Start Time</span>
                  <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </label>
                <label>
                  <span>End Time</span>
                  <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </label>
                <label className="span-2">
                  <span>Check-in Status</span>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="active">Active — check-in open</option>
                    <option value="closed">Closed — check-in closed</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Attendance options</h4>
                <p className="muted small">Control how scans are verified and confirmed for this event.</p>
              </div>
              <div className="event-form-options">
                <label className={`event-option-card ${form.requireStudentConfirm ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={form.requireStudentConfirm}
                    onChange={(e) => setForm({ ...form, requireStudentConfirm: e.target.checked })}
                  />
                  <span className="event-option-copy">
                    <span className="event-option-title">Require student number confirmation</span>
                    <span className="event-option-desc">Ask for the student number after scanning (anti-sharing / kiosk mode).</span>
                  </span>
                </label>
                <label className={`event-option-card ${form.autoConfirm ? 'is-on' : ''} ${form.requireStudentConfirm ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={form.autoConfirm}
                    disabled={form.requireStudentConfirm}
                    onChange={(e) => setForm({ ...form, autoConfirm: e.target.checked })}
                  />
                  <span className="event-option-copy">
                    <span className="event-option-title">Auto-confirm scans</span>
                    <span className="event-option-desc">
                      Save matched scans immediately without clicking Confirm when staff is monitoring.
                      {form.requireStudentConfirm ? ' Not available when student number confirmation is required.' : ''}
                    </span>
                  </span>
                </label>
              </div>
            </section>

            {formError && <div className="alert alert-error">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
