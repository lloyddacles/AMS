import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyForm = { name: '', startDate: '', endDate: '', minAttendance: 80, isCurrent: false };

export default function Terms() {
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setLoading(true);
    try {
      setTerms(await api.getTerms());
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

  function openEdit(t) {
    setEditing(t);
    setForm({ name: t.name, startDate: t.startDate, endDate: t.endDate, minAttendance: t.minAttendance ?? 80, isCurrent: !!Number(t.isCurrent) });
    setFormError('');
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = { ...form, minAttendance: Number(form.minAttendance) || 80 };
      if (editing?.id) await api.updateTerm(editing.id, payload);
      else await api.createTerm(payload);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function makeCurrent(t) {
    try {
      await api.setCurrentTerm(t.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function remove(t) {
    if (!confirm(`Delete "${t.name}"? Events and schedules keep their data but lose this term link.`)) return;
    try {
      await api.deleteTerm(t.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Terms</h2>
          <p className="muted">School terms or semesters. Group events and schedules by term.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Add term</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && terms.length === 0 && <div className="card"><Spinner label="Loading terms…" size="lg" variant="panel" /></div>}

      {!loading && terms.length === 0 && (
        <div className="empty card">
          <p>No terms yet. Create one (e.g. “2nd Semester AY 2025–2026”) to start scheduling recurring events.</p>
        </div>
      )}

      {!loading && terms.length > 0 && (
        <div className="card table-card">
          <table className="table">
            <thead>
            <tr>
              <th>Term</th>
              <th>Dates</th>
              <th>Min %</th>
              <th>Events</th>
              <th>Schedules</th>
              <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="strong">{t.name}</div>
                    <div className="muted small">{t.isCurrent ? 'Current term' : ''}</div>
                  </td>
                  <td className="mono">{t.startDate} → {t.endDate}</td>
                  <td className="mono">{t.minAttendance ?? 80}%</td>
                  <td>{t.eventCount}</td>
                  <td>{t.scheduleCount}</td>
                  <td>
                    {Number(t.isCurrent) === 1 ? (
                      <span className="pill pill-green">current</span>
                    ) : (
                      <button className="btn btn-sm" onClick={() => makeCurrent(t)}>Set current</button>
                    )}
                  </td>
                  <td className="right actions">
                    <button className="btn btn-sm" onClick={() => openEdit(t)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(t)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit term' : 'Add term'}
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
              Term name *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="2nd Semester AY 2025–2026" required />
            </label>
            <label>
              Start date *
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </label>
            <label>
              End date *
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </label>
            <label>
              Minimum attendance %
              <input type="number" min="0" max="100" value={form.minAttendance} onChange={(e) => setForm({ ...form, minAttendance: e.target.value })} />
            </label>
            <label className="checkbox span-2">
              <input type="checkbox" checked={form.isCurrent} onChange={(e) => setForm({ ...form, isCurrent: e.target.checked })} />
              Make this the current term
            </label>
            {formError && <div className="alert alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
