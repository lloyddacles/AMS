import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';

const emptyForm = {
  name: '',
  description: '',
  location: '',
  eventDate: '',
  startTime: '',
  endTime: '',
  status: 'active',
  requireStudentConfirm: false,
};

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setLoading(true);
    try {
      setEvents(await api.getEvents());
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
    setForm(emptyForm);
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
    });
    setFormError('');
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editing?.id) await api.updateEvent(editing.id, form);
      else await api.createEvent(form);
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Events</h2>
          <p className="muted">{events.length} event{events.length === 1 ? '' : 's'}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Add Event</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="muted">Loading…</div>}

      {!loading && events.length === 0 && (
        <div className="empty card">
          <h3>No events yet</h3>
          <p className="muted">Create your first event to start tracking attendance.</p>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Event</button>
        </div>
      )}

      <div className="event-grid">
        {events.map((ev) => {
          const rate = ev.totalStudents ? Math.round((ev.attendanceCount / ev.totalStudents) * 100) : 0;
          return (
            <div key={ev.id} className="card event-card">
              <div className="event-card-top">
                <span className={`pill ${ev.status === 'active' ? 'pill-green' : 'pill-gray'}`}>{ev.status}</span>
                <span className="muted small">{ev.eventDate}{ev.startTime ? ` · ${ev.startTime}` : ''}</span>
              </div>
              <h3>{ev.name}</h3>
              <p className="muted small clamp">{ev.description || 'No description'}</p>
              <p className="muted small">📍 {ev.location || 'Location TBD'}</p>
              {ev.requireStudentConfirm ? (
                <p className="small"><span className="pill pill-blue">Kiosk · ID required</span></p>
              ) : (
                <p className="small"><span className="pill pill-gray">Staff scan</span></p>
              )}
              <div className="rate-wrap">
                <div className="rate-bar"><span style={{ width: `${rate}%` }} /></div>
                <span className="rate-label">{ev.attendanceCount}/{ev.totalStudents}</span>
              </div>
              <div className="event-card-actions">
                <Link className="btn btn-sm btn-primary" to={`/events/${ev.id}`}>Open</Link>
                <button className="btn btn-sm" onClick={() => openEdit(ev)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(ev)}>Delete</button>
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
            <label className="checkbox span-2">
              <input
                type="checkbox"
                checked={form.requireStudentConfirm}
                onChange={(e) => setForm({ ...form, requireStudentConfirm: e.target.checked })}
              />
              <span>Require student number confirmation when scanning (anti-sharing / kiosk mode)</span>
            </label>
            {formError && <div className="alert alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
