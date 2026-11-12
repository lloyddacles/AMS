import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useDialog } from '../dialogs.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

function emptyDept() {
  return { name: '' };
}

function emptyProg() {
  return { name: '', code: '', departmentId: '', active: true };
}

export default function Colleges() {
  const { confirm, notify } = useDialog();
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [error, setError] = useState('');
  const [deptForm, setDeptForm] = useState(emptyDept());
  const [deptEditing, setDeptEditing] = useState(null);
  const [progForm, setProgForm] = useState(emptyProg());
  const [progEditing, setProgEditing] = useState(null);
  const [savingDept, setSavingDept] = useState(false);
  const [savingProg, setSavingProg] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getAcademicStructure({ includeInactivePrograms: 1 });
      setDepartments(data.departments || []);
      setPrograms(data.programs || []);
    } catch (e) {
      setError(e.message || 'Failed to load colleges and programs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const programsByDept = useMemo(() => {
    const map = new Map();
    for (const d of departments) map.set(d.id, []);
    for (const p of programs) {
      if (!map.has(p.departmentId)) map.set(p.departmentId, []);
      map.get(p.departmentId).push(p);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [departments, programs]);

  async function submitDept(e) {
    e.preventDefault();
    setSavingDept(true);
    try {
      if (deptEditing) {
        await api.updateDepartment(deptEditing.id, deptForm);
        await notify({ title: 'College updated', message: 'College/department updated successfully.' });
      } else {
        await api.createDepartment(deptForm);
        await notify({ title: 'College added', message: 'College/department added successfully.' });
      }
      setDeptForm(emptyDept());
      setDeptEditing(null);
      await load();
    } catch (err) {
      await notify({ title: 'Action failed', message: err.message || 'Unable to save college/department.' });
    } finally {
      setSavingDept(false);
    }
  }

  async function submitProg(e) {
    e.preventDefault();
    setSavingProg(true);
    try {
      if (progEditing) {
        await api.updateProgram(progEditing.id, progForm);
        await notify({ title: 'Program updated', message: 'Program updated successfully.' });
      } else {
        await api.createProgram(progForm);
        await notify({ title: 'Program added', message: 'Program added successfully.' });
      }
      setProgForm(emptyProg());
      setProgEditing(null);
      await load();
    } catch (err) {
      await notify({ title: 'Action failed', message: err.message || 'Unable to save program.' });
    } finally {
      setSavingProg(false);
    }
  }

  async function removeDept(dept) {
    const ok = await confirm({ title: 'Delete college/department', message: `Delete "${dept.name}"? Programs under it will be deleted and linked users/students/events may become unscoped. This cannot be undone.`, confirmText: 'Delete', cancelText: 'Cancel' });
    if (!ok) return;
    try {
      await api.deleteDepartment(dept.id);
      await notify({ title: 'College deleted', message: 'College/department deleted.' });
      await load();
    } catch (err) {
      await notify({ title: 'Delete failed', message: err.message || 'Unable to delete college/department.' });
    }
  }

  async function removeProg(prog) {
    const ok = await confirm({ title: 'Delete program', message: `Delete "${prog.name}" (${prog.departmentName})? Linked students/users/events may lose their program assignment. This cannot be undone.`, confirmText: 'Delete', cancelText: 'Cancel' });
    if (!ok) return;
    try {
      await api.deleteProgram(prog.id);
      await notify({ title: 'Program deleted', message: 'Program deleted.' });
      await load();
    } catch (err) {
      await notify({ title: 'Delete failed', message: err.message || 'Unable to delete program.' });
    }
  }

  if (loading) {
    return (
      <div className="card">
        <Spinner label="Loading colleges and programs…" size="lg" variant="panel" />
      </div>
    );
  }

  return (
    <div className="page colleges-page">
      <PageHeader
        eyebrow="Academic Structure"
        title="Colleges"
        subtitle="Create, update, and manage colleges/departments and their programs."
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid two">
        <section className="card">
          <div className="card-header">
            <div>
              <h3>{deptEditing ? 'Edit College / Department' : 'Add College / Department'}</h3>
              <p className="muted small">Colleges are top-level academic units.</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={submitDept}>
            <label className="form-field">
              <span>Name</span>
              <input value={deptForm.name} onChange={(e) => setDeptForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g., College of Computer Studies" required />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={savingDept}>{savingDept ? 'Saving…' : deptEditing ? 'Save changes' : 'Add college'}</button>
              {deptEditing && <button className="btn" type="button" onClick={() => { setDeptEditing(null); setDeptForm(emptyDept()); }}>Cancel</button>}
            </div>
          </form>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3>{progEditing ? 'Edit Program' : 'Add Program'}</h3>
              <p className="muted small">Assign programs to a college/department.</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={submitProg}>
            <label className="form-field">
              <span>College / Department</span>
              <select value={progForm.departmentId} onChange={(e) => setProgForm((f) => ({ ...f, departmentId: e.target.value }))} required>
                <option value="">Select college/department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Program Name</span>
              <input value={progForm.name} onChange={(e) => setProgForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g., Bachelor of Science in Information Systems" required />
            </label>
            <label className="form-field">
              <span>Code (optional)</span>
              <input value={progForm.code} onChange={(e) => setProgForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g., BSIS" />
            </label>
            {progEditing && (
              <label className="form-field checkbox-field">
                <input type="checkbox" checked={progForm.active !== false && progForm.active !== 0} onChange={(e) => setProgForm((f) => ({ ...f, active: e.target.checked }))} />
                <span>Active</span>
              </label>
            )}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={savingProg}>{savingProg ? 'Saving…' : progEditing ? 'Save changes' : 'Add program'}</button>
              {progEditing && <button className="btn" type="button" onClick={() => { setProgEditing(null); setProgForm(emptyProg()); }}>Cancel</button>}
            </div>
          </form>
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Colleges & Programs</h3>
            <p className="muted small">Manage all colleges/departments and their programs.</p>
          </div>
        </div>
        {departments.length === 0 ? (
          <div className="empty-state">No colleges/departments yet. Add one above.</div>
        ) : (
          <div className="stack">
            {departments.map((d) => {
              const progs = programsByDept.get(d.id) || [];
              return (
                <article key={d.id} className="card subtle">
                  <div className="card-header">
                    <div>
                      <h4 style={{ margin: 0 }}>{d.name}</h4>
                      <p className="muted small">{progs.length} program{progs.length === 1 ? '' : 's'} · {d.userCount || 0} staff/users · {d.studentCount || 0} students · {d.eventCount || 0} events</p>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => { setDeptEditing(d); setDeptForm({ name: d.name }); setProgEditing(null); setProgForm(emptyProg()); }}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeDept(d)}>Delete</button>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Program</th>
                          <th>Code</th>
                          <th>Status</th>
                          <th>Usage</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {progs.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="muted">No programs yet.</td>
                          </tr>
                        ) : (
                          progs.map((p) => (
                            <tr key={p.id}>
                              <td>{p.name}</td>
                              <td>{p.code || '—'}</td>
                              <td><span className={`pill ${Number(p.active) === 1 ? 'pill-green' : 'pill-gray'}`}>{Number(p.active) === 1 ? 'Active' : 'Inactive'}</span></td>
                              <td className="muted small">{p.userCount || 0} staff · {p.studentCount || 0} students · {p.eventCount || 0} events</td>
                              <td style={{ textAlign: 'right' }}>
                                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                                  <button className="btn btn-sm" onClick={() => { setProgEditing(p); setProgForm({ name: p.name, code: p.code || '', departmentId: String(p.departmentId), active: Number(p.active) === 1 }); setDeptEditing(null); setDeptForm(emptyDept()); }}>Edit</button>
                                  <button className="btn btn-sm btn-danger" onClick={() => removeProg(p)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
