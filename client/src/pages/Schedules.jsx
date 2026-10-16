import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
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
};

export default function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [terms, setTerms] = useState([]);
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
      const [s, t] = await Promise.all([api.getSchedules(), api.getTerms()]);
      setSchedules(s);
      setTerms(t);
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
    const current = terms.find((t) => Number(t.isCurrent) === 1);
    setForm({
      ...emptyForm,
      termId: current ? String(current.id) : '',
      startDate: current?.startDate || '',
      endDate: current?.endDate || '',
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
      };
      if (editing?.id) await api.updateSchedule(editing.id, payload);
      else await api.createSchedule(payload);
      setEditing(null);
      await load();
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
      setResult(
        r.created > 0
          ? `Generated ${r.created} event${r.created === 1 ? '' : 's'} for “${s.name}” (${r.skipped} already existed).`
          : `No new events for “${s.name}” — all ${r.skipped} already exist.`
      );
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setGenerating(null);
    }
  }

  async function remove(s) {
    if (!confirm(`Delete schedule "${s.name}"? Generated events are kept.`)) return;
    try {
      await api.deleteSchedule(s.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Class Schedules</h2>
          <p className="muted">Define recurring sessions once, then generate all their events in a click.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New schedule</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-success">{result}</div>}

      {loading && schedules.length === 0 && <div className="card"><Spinner label="Loading schedules…" size="lg" variant="panel" /></div>}

      {!loading && schedules.length === 0 && (
        <div className="empty card">
          <p>No schedules yet. Create one (e.g. “CS101 — MWF 9:00–10:00”) to auto-generate its events.</p>
        </div>
      )}

      {!loading && schedules.length > 0 && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Schedule</th>
                <th>Term</th>
                <th>Days</th>
                <th>Time</th>
                <th>Date range</th>
                <th>Events</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="strong">
                    {s.name}
                    {Number(s.active) === 0 && <span className="pill pill-gray" style={{ marginLeft: '0.5rem' }}>inactive</span>}
                    {s.location && <div className="muted small">{s.location}</div>}
                  </td>
                  <td>{s.termName || <span className="muted">—</span>}</td>
                  <td>{s.weekdayLabel || '—'}</td>
                  <td className="mono">{s.startTime || '—'}{s.endTime ? `–${s.endTime}` : ''}</td>
                  <td className="mono">{s.startDate} → {s.endDate}</td>
                  <td>{s.eventCount}</td>
                  <td className="right actions">
                    <button className="btn btn-sm btn-primary" onClick={() => generate(s)} disabled={generating === s.id}>
                      {generating === s.id ? 'Generating…' : 'Generate'}
                    </button>
                    <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit schedule' : 'New schedule'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <form className="form grid-form" onSubmit={save}>
            <label className="span-2">
              Schedule name *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CS101 — Data Structures" required />
            </label>
            <label>
              Term
              <select value={form.termId} onChange={(e) => onTermChange(e.target.value)}>
                <option value="">— none —</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>
                ))}
              </select>
            </label>
            <label>
              Location
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Room 204" />
            </label>
            <div className="span-2">
              <span className="field-label">Repeats on *</span>
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
              Start time
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </label>
            <label>
              End time
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </label>
            <label>
              From date *
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </label>
            <label>
              Until date *
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </label>
            <label className="span-2">
              Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.requireStudentConfirm} onChange={(e) => setForm({ ...form, requireStudentConfirm: e.target.checked })} />
              Require student number confirmation
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
            {formError && <div className="alert alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
