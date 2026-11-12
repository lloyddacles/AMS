import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import { useDialog } from '../dialogs.jsx';
import Spinner from '../components/Spinner.jsx';

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const emptyForm = {
  name: '',
  termId: '',
  weekdays: [],
  startTime: '',
  endTime: '',
  startDate: '',
  endDate: '',
  location: '',
  description: '',
  requireStudentConfirm: false,
  active: true,
  departmentId: '',
  programId: '',
};

export default function Schedules() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [schedules, setSchedules] = useState([]);
  const [terms, setTerms] = useState([]);
  const [academic, setAcademic] = useState({ departments: [], programs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [generating, setGenerating] = useState(null);
  const [result, setResult] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [s, t, acad] = await Promise.all([
        api.getSchedules(),
        api.getTerms(),
        api.getAcademicStructure().catch(() => ({ departments: [], programs: [] })),
      ]);
      setSchedules(s);
      setTerms(t);
      setAcademic(acad || { departments: [], programs: [] });
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

  const programsForDept = useMemo(() => {
    const did = Number(form.departmentId || 0);
    if (!did) return academic.programs || [];
    return (academic.programs || []).filter((p) => Number(p.departmentId) === did);
  }, [academic.programs, form.departmentId]);

  function defaultScope() {
    if (isAdmin) return { departmentId: '', programId: '' };
    return {
      departmentId: user?.departmentId ? String(user.departmentId) : '',
      programId: user?.programId ? String(user.programId) : '',
    };
  }

  function openCreate() {
    setEditing({});
    const current = terms.find((t) => Number(t.isCurrent) === 1);
    setForm({
      ...emptyForm,
      termId: current ? String(current.id) : '',
      startDate: current?.startDate || '',
      endDate: current?.endDate || '',
      ...defaultScope(),
    });
    setFormError('');
  }

  function openEdit(s) {
    setEditing(s);
    setForm({
      name: s.name || '',
      termId: s.termId ? String(s.termId) : '',
      weekdays: String(s.weekdays || '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n)),
      startTime: s.startTime || '',
      endTime: s.endTime || '',
      startDate: s.startDate || '',
      endDate: s.endDate || '',
      location: s.location || '',
      description: s.description || '',
      requireStudentConfirm: !!Number(s.requireStudentConfirm),
      active: !!Number(s.active),
      departmentId: s.departmentId ? String(s.departmentId) : (isAdmin ? '' : (user?.departmentId ? String(user.departmentId) : '')),
      programId: s.programId ? String(s.programId) : (isAdmin ? '' : (user?.programId ? String(user.programId) : '')),
    });
    setFormError('');
  }

  function toggleWeekday(value) {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(value) ? f.weekdays.filter((v) => v !== value) : [...f.weekdays, value],
    }));
  }

  function onTermChange(value) {
    const term = terms.find((t) => String(t.id) === value);
    setForm((f) => ({
      ...f,
      termId: value,
      startDate: term?.startDate || f.startDate,
      endDate: term?.endDate || f.endDate,
    }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        termId: form.termId ? Number(form.termId) : null,
        weekdays: form.weekdays,
        departmentId: form.departmentId || null,
        programId: form.programId || null,
      };
      if (editing?.id) await api.updateSchedule(editing.id, payload);
      else await api.createSchedule(payload);
      const wasEdit = Boolean(editing?.id);
      setEditing(null);
      await load();
      await notify({ title: wasEdit ? 'Schedule updated' : 'Schedule created', message: wasEdit ? 'Schedule details were saved successfully.' : 'The schedule was created successfully.' });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function generate(s) {
    setGenerating(s.id);
    setResult('');
    try {
      const r = await api.generateSchedule(s.id);
      const msg = r.created > 0
        ? `Generated ${r.created} event${r.created === 1 ? '' : 's'} for “${s.name}” (${r.skipped} already existed).`
        : `No new events for “${s.name}” — all ${r.skipped} already exist.`;
      setResult(msg);
      await load();
      await notify({ title: 'Schedule generated', message: msg });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to generate events.' });
    } finally {
      setGenerating(null);
    }
  }

  async function remove(s) {
    const ok = await confirm({ title: 'Delete schedule', message: `Delete schedule "${s.name}"? Generated events are kept.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deleteSchedule(s.id);
      await load();
      await notify({ title: 'Schedule deleted', message: `"${s.name}" was deleted successfully.` });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to delete the schedule.' });
    }
  }

  const activeCount = schedules.filter((s) => Number(s.active)).length;
  const generatedCount = schedules.reduce((sum, s) => sum + (Number(s.eventCount) || 0), 0);
  const termCount = new Set(schedules.map((s) => s.termId).filter(Boolean)).size;

  return (
    <div className="page schedules-page">
      <PageHeader
        eyebrow="Recurring sessions"
        title="Class Schedules"
        subtitle="Define recurring sessions once, then generate all their events in a click."
        actions={<button className="btn btn-primary" onClick={openCreate}>+ New schedule</button>}
      />

      <div className="stat-grid">
        <StatCard icon="layers" accent="blue" label="Schedules" value={schedules.length} hint="Total defined" />
        <StatCard icon="live" accent="green" label="Active" value={activeCount} hint="Generating events" />
        <StatCard icon="calendar" accent="purple" label="Events generated" value={generatedCount} hint="Across all schedules" />
        <StatCard icon="book" accent="amber" label="Terms used" value={termCount} hint="Linked to a term" />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-success">{result}</div>}

      {!isAdmin && (user?.departmentId || user?.programId) && (
        <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
          Showing schedule generation for your assigned scope: <strong>{user?.departmentName || 'Department'}</strong>{user?.programName ? ` · ${user.programName}` : ''}. Generated events will be tagged to this scope.
        </div>
      )}

      {loading && schedules.length === 0 && <div className="card"><Spinner label="Loading schedules…" size="lg" variant="panel" /></div>}

      {!loading && schedules.length === 0 && (
        <div className="empty card schedules-empty">
          <div className="events-empty-icon">❖</div>
          <h3>No schedules yet</h3>
          <p className="muted">Create a recurring schedule (e.g. “CS101 — MWF 9:00–10:00”) to auto-generate attendance events for the full date range.</p>
          <button className="btn btn-primary" onClick={openCreate}>+ Create schedule</button>
        </div>
      )}

      {!loading && schedules.length > 0 && (
        <div className="schedule-grid">
          {schedules.map((s) => {
            const active = Number(s.active) !== 0;
            const days = String(s.weekdayLabel || '').split(',').map((d) => d.trim()).filter(Boolean);
            return (
              <div key={s.id} className={`card schedule-card ${active ? '' : 'is-inactive'}`}>
                <div className="schedule-card-top">
                  <div className="schedule-card-badges">
                    <span className={`pill ${active ? 'pill-green' : 'pill-gray'}`}>{active ? 'Active' : 'Inactive'}</span>
                    {s.termName ? <span className="pill pill-purple">{s.termName}</span> : <span className="pill pill-gray">No term</span>}
                    {Number(s.requireStudentConfirm) ? <span className="pill pill-blue">Kiosk · ID</span> : null}
                    {(s.departmentName || s.programName) ? <span className="pill pill-amber">{s.programName || s.departmentName}</span> : <span className="pill pill-gray">Unscoped</span>}
                  </div>
                  <span className="schedule-event-count" title="Generated events">{s.eventCount} events</span>
                </div>

                <div className="schedule-card-body">
                  <h3 className="schedule-card-title">{s.name}</h3>
                  {s.description ? <p className="muted small clamp">{s.description}</p> : <p className="muted small">No description</p>}

                  <div className="schedule-meta-grid">
                    <div className="schedule-meta-item">
                      <span className="schedule-meta-label">Days</span>
                      <div className="schedule-days">
                        {days.length ? days.map((d) => <span key={d} className="schedule-day-chip">{d}</span>) : <span className="muted">—</span>}
                      </div>
                    </div>
                    <div className="schedule-meta-item">
                      <span className="schedule-meta-label">Time</span>
                      <span className="mono">{s.startTime || '—'}{s.endTime ? `–${s.endTime}` : ''}</span>
                    </div>
                    <div className="schedule-meta-item">
                      <span className="schedule-meta-label">Date range</span>
                      <span className="mono small">{s.startDate} → {s.endDate}</span>
                    </div>
                    <div className="schedule-meta-item">
                      <span className="schedule-meta-label">Location</span>
                      <span>{s.location || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="schedule-card-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => generate(s)} disabled={generating === s.id}>
                    {generating === s.id ? 'Generating…' : 'Generate events'}
                  </button>
                  <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal
          wide
          title={editing.id ? 'Edit schedule' : 'New schedule'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
            </>
          }
        >
          <form className="form event-form" onSubmit={save}>
            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Schedule details</h4>
                <p className="muted small">Name this recurring session and where it takes place.</p>
              </div>
              <div className="form grid-form">
                <label className="span-2">
                  <span>Schedule name <span className="req">*</span></span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CS101 — Data Structures" required />
                </label>
                <label>
                  <span>Term</span>
                  <select value={form.termId} onChange={(e) => onTermChange(e.target.value)}>
                    <option value="">— none —</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Location</span>
                  <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Room 204" />
                </label>
                <label className="span-2">
                  <span>Description</span>
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional notes for generated events" />
                </label>
              </div>
            </section>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>College / Program scope</h4>
                <p className="muted small">
                  {isAdmin
                    ? 'Assign this schedule to a college/program so scoped staff only see and generate schedules relevant to them. Generated events inherit this scope.'
                    : 'This schedule is scoped to your assigned college/program. Generated events will inherit this scope.'}
                </p>
              </div>
              <div className="form grid-form">
                <label>
                  <span>College / Department</span>
                  <select
                    value={form.departmentId}
                    onChange={(e) => {
                      const did = e.target.value;
                      const ok = (academic.programs || []).some((p) => String(p.id) === String(form.programId) && String(p.departmentId) === did);
                      setForm((f) => ({ ...f, departmentId: did, programId: ok ? f.programId : '' }));
                    }}
                    disabled={!isAdmin && !!(user?.departmentId || user?.programId)}
                  >
                    <option value="">{isAdmin ? 'All colleges (global)' : '—'}</option>
                    {(academic.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Program</span>
                  <select
                    value={form.programId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const prog = (academic.programs || []).find((p) => String(p.id) === String(pid));
                      setForm((f) => ({ ...f, programId: pid, departmentId: prog ? String(prog.departmentId) : f.departmentId }));
                    }}
                    disabled={!isAdmin && !!user?.programId}
                  >
                    <option value="">{form.departmentId ? 'All programs in college' : 'Select a college first'}</option>
                    {(form.departmentId ? (academic.programs || []).filter((p) => String(p.departmentId) === String(form.departmentId)) : (academic.programs || [])).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Recurrence & time</h4>
                <p className="muted small">Choose which days repeat and the session time window.</p>
              </div>
              <div className="form grid-form">
                <div className="span-2">
                  <span className="field-label">Repeats on <span className="req">*</span></span>
                  <div className="weekday-picker">
                    {WEEKDAYS.map((d) => (
                      <button
                        type="button"
                        key={d.value}
                        className={`weekday-chip ${form.weekdays.includes(d.value) ? 'on' : ''}`}
                        onClick={() => toggleWeekday(d.value)}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span>Start time</span>
                  <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </label>
                <label>
                  <span>End time</span>
                  <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </label>
                <label>
                  <span>From date <span className="req">*</span></span>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
                </label>
                <label>
                  <span>Until date <span className="req">*</span></span>
                  <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
                </label>
              </div>
            </section>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Options</h4>
                <p className="muted small">Defaults applied to generated events and schedule status.</p>
              </div>
              <div className="event-form-options">
                <label className={`event-option-card ${form.requireStudentConfirm ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={form.requireStudentConfirm} onChange={(e) => setForm({ ...form, requireStudentConfirm: e.target.checked })} />
                  <span className="event-option-copy">
                    <span className="event-option-title">Require student number confirmation</span>
                    <span className="event-option-desc">Generated events will ask for student number confirmation during scanning (kiosk/anti-sharing mode).</span>
                  </span>
                </label>
                <label className={`event-option-card ${form.active ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  <span className="event-option-copy">
                    <span className="event-option-title">Active schedule</span>
                    <span className="event-option-desc">Keep this schedule active for generating and managing recurring events.</span>
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
