import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useDialog } from '../dialogs.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyDept = { name: '' };
const emptyProg = { name: '', code: '', departmentId: '', active: true };

export default function Colleges() {
  const { confirm, notify } = useDialog();
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');

  const [deptModal, setDeptModal] = useState(null); // { mode:'create'|'edit', data }
  const [deptForm, setDeptForm] = useState(emptyDept);
  const [deptSaving, setDeptSaving] = useState(false);
  const [deptError, setDeptError] = useState('');

  const [progModal, setProgModal] = useState(null); // { mode:'create'|'edit', data, presetDeptId? }
  const [progForm, setProgForm] = useState(emptyProg);
  const [progSaving, setProgSaving] = useState(false);
  const [progError, setProgError] = useState('');

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

  const stats = useMemo(() => {
    const activePrograms = programs.filter((p) => Number(p.active) === 1).length;
    const inactivePrograms = programs.length - activePrograms;
    const inUse = programs.filter((p) => (p.userCount || 0) + (p.studentCount || 0) + (p.eventCount || 0) > 0).length;
    return { colleges: departments.length, programs: programs.length, activePrograms, inactivePrograms, inUse };
  }, [departments, programs]);

  const filteredDepartments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return departments.filter((d) => {
      if (filterDept !== 'all' && String(d.id) !== String(filterDept)) return false;
      if (!q) return true;
      if (d.name.toLowerCase().includes(q)) return true;
      return (programsByDept.get(d.id) || []).some((p) =>
        [p.name, p.code || '', Number(p.active) === 1 ? 'active' : 'inactive'].join(' ').toLowerCase().includes(q)
      );
    });
  }, [departments, filterDept, search, programsByDept]);

  function openCreateDept() {
    setDeptModal({ mode: 'create' });
    setDeptForm({ ...emptyDept });
    setDeptError('');
  }
  function openEditDept(dept) {
    setDeptModal({ mode: 'edit', data: dept });
    setDeptForm({ name: dept.name || '' });
    setDeptError('');
  }
  function openCreateProg(presetDeptId = '') {
    setProgModal({ mode: 'create' });
    setProgForm({ ...emptyProg, departmentId: presetDeptId ? String(presetDeptId) : '' });
    setProgError('');
  }
  function openEditProg(prog) {
    setProgModal({ mode: 'edit', data: prog });
    setProgForm({ name: prog.name || '', code: prog.code || '', departmentId: String(prog.departmentId || ''), active: Number(prog.active) === 1 });
    setProgError('');
  }

  async function saveDept(e) {
    e?.preventDefault();
    setDeptSaving(true);
    setDeptError('');
    try {
      if (deptModal?.mode === 'edit') {
        await api.updateDepartment(deptModal.data.id, deptForm);
        await notify({ title: 'College updated', message: 'College/department updated successfully.' });
      } else {
        await api.createDepartment(deptForm);
        await notify({ title: 'College added', message: 'College/department added successfully.' });
      }
      setDeptModal(null);
      await load();
    } catch (err) {
      setDeptError(err.message || 'Unable to save college/department.');
    } finally {
      setDeptSaving(false);
    }
  }

  async function saveProg(e) {
    e?.preventDefault();
    setProgSaving(true);
    setProgError('');
    try {
      if (progModal?.mode === 'edit') {
        await api.updateProgram(progModal.data.id, progForm);
        await notify({ title: 'Program updated', message: 'Program updated successfully.' });
      } else {
        await api.createProgram(progForm);
        await notify({ title: 'Program added', message: 'Program added successfully.' });
      }
      setProgModal(null);
      await load();
    } catch (err) {
      setProgError(err.message || 'Unable to save program.');
    } finally {
      setProgSaving(false);
    }
  }

  async function removeDept(dept) {
    const ok = await confirm({
      title: 'Delete college/department',
      message: `Delete "${dept.name}"? Programs under it will be deleted and linked users/students/events may become unscoped. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
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
    const ok = await confirm({
      title: 'Delete program',
      message: `Delete "${prog.name}" (${prog.departmentName})? Linked students/users/events may lose their program assignment. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
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
    <div className="page">
      <PageHeader
        eyebrow="Academic structure"
        title="Colleges"
        subtitle="Manage colleges/departments and their programs used for scoping, filters, and reporting."
        actions={
          <>
            <button className="btn" onClick={openCreateDept}>+ Add college</button>
            <button className="btn btn-primary" onClick={() => openCreateProg()}>+ Add program</button>
          </>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="stat-grid">
        <StatCard icon="layers" accent="blue" label="Colleges" value={stats.colleges} hint="Departments/colleges" />
        <StatCard icon="book" accent="purple" label="Programs" value={stats.programs} hint="Total programs" />
        <StatCard icon="check" accent="green" label="Active programs" value={stats.activePrograms} hint={stats.inactivePrograms ? `${stats.inactivePrograms} inactive` : 'All active'} />
        <StatCard icon="users" accent="amber" label="Programs in use" value={stats.inUse} hint="Linked to users/students/events" />
      </div>

      <div className="toolbar filter-bar">
        <input className="search" placeholder="Search colleges or programs…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
          <option value="all">All colleges</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {(search || filterDept !== 'all') && (
          <button className="btn btn-sm" onClick={() => { setSearch(''); setFilterDept('all'); }}>Clear</button>
        )}
      </div>

      {departments.length === 0 ? (
        <div className="empty card">
          <p>No colleges/departments yet. Add a college to start organizing programs and scoping.</p>
        </div>
      ) : filteredDepartments.length === 0 ? (
        <div className="empty card">
          <p>No colleges or programs match your search/filter.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {filteredDepartments.map((d) => {
            const progs = programsByDept.get(d.id) || [];
            const visibleProgs = search.trim()
              ? progs.filter((p) => [p.name, p.code || '', Number(p.active) === 1 ? 'active' : 'inactive'].join(' ').toLowerCase().includes(search.trim().toLowerCase()) || d.name.toLowerCase().includes(search.trim().toLowerCase()))
              : progs;
            return (
              <section key={d.id} className="card table-card">
                <div className="dash-card-head" style={{ padding: '1rem 1rem 0.75rem', marginBottom: 0 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{d.name}</h3>
                    <p className="muted small" style={{ marginTop: '0.2rem' }}>
                      {progs.length} program{progs.length === 1 ? '' : 's'} · {d.userCount || 0} staff/users · {d.studentCount || 0} students · {d.eventCount || 0} events
                    </p>
                  </div>
                  <div className="row-actions">
                    <button className="btn btn-sm" onClick={() => openCreateProg(d.id)}>+ Program</button>
                    <button className="btn btn-sm" onClick={() => openEditDept(d)}>Edit</button>
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
                        <th className="right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProgs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>
                            No programs {search.trim() ? 'match your search' : 'in this college yet'}.
                          </td>
                        </tr>
                      ) : (
                        visibleProgs.map((p) => (
                          <tr key={p.id}>
                            <td><div className="strong">{p.name}</div></td>
                            <td className="mono">{p.code || '—'}</td>
                            <td>
                              <span className={`pill ${Number(p.active) === 1 ? 'pill-green' : 'pill-gray'}`}>
                                {Number(p.active) === 1 ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="muted small">{p.userCount || 0} staff · {p.studentCount || 0} students · {p.eventCount || 0} events</td>
                            <td className="right actions">
                              <button className="btn btn-sm" onClick={() => openEditProg(p)}>Edit</button>
                              <button className="btn btn-sm btn-danger" onClick={() => removeProg(p)}>Delete</button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {deptModal && (
        <Modal
          title={deptModal.mode === 'edit' ? 'Edit college' : 'Add college'}
          onClose={() => setDeptModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeptModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDept} disabled={deptSaving}>{deptSaving ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <form className="form grid-form" onSubmit={saveDept}>
            <label className="span-2">
              College/Department name *
              <input value={deptForm.name} onChange={(e) => setDeptForm({ name: e.target.value })} placeholder="e.g., College of Computer Studies" required autoFocus />
            </label>
            {deptError && <div className="alert alert-error span-2">{deptError}</div>}
          </form>
        </Modal>
      )}

      {progModal && (
        <Modal
          title={progModal.mode === 'edit' ? 'Edit program' : 'Add program'}
          onClose={() => setProgModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setProgModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProg} disabled={progSaving}>{progSaving ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <form className="form grid-form" onSubmit={saveProg}>
            <label className="span-2">
              College/Department *
              <select value={progForm.departmentId} onChange={(e) => setProgForm((f) => ({ ...f, departmentId: e.target.value }))} required>
                <option value="">Select college/department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="span-2">
              Program name *
              <input value={progForm.name} onChange={(e) => setProgForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g., Bachelor of Science in Information Systems" required />
            </label>
            <label>
              Code (optional)
              <input value={progForm.code} onChange={(e) => setProgForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g., BSIS" />
            </label>
            {progModal.mode === 'edit' && (
              <label className="checkbox" style={{ alignSelf: 'end', marginBottom: '0.1rem' }}>
                <input type="checkbox" checked={!!progForm.active} onChange={(e) => setProgForm((f) => ({ ...f, active: e.target.checked }))} />
                <span>Active program</span>
              </label>
            )}
            {progError && <div className="alert alert-error span-2">{progError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
