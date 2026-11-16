import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useDialog } from '../dialogs.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyBloc = {
  name: '',
  description: '',
  course: '',
  yearLevel: '',
  section: '',
  departmentId: '',
  programId: '',
  active: true,
};

function displayName(s) {
  return `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, '') || s.studentNo || '—';
}

export default function Blocs() {
  const { user } = useAuth();
  const { confirm, notify } = useDialog();
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [blocs, setBlocs] = useState([]);
  const [students, setStudents] = useState([]);
  const [academic, setAcademic] = useState({ departments: [], programs: [] });
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode, bloc, form, saving, error }
  const [membersModal, setMembersModal] = useState(null); // { bloc, members, loading, search, section, selected, saving, error }
  const [toast, setToast] = useState('');

  const scopedLock = !isAdmin && !!(user?.departmentId || user?.programId);

  async function load() {
    setLoading(true);
    try {
      const [b, s, a] = await Promise.all([
        api.getBlocs({ search: '', includeInactive: showInactive ? 1 : 0 }),
        api.getStudents(),
        api.getAcademicStructure().catch(() => ({ departments: [], programs: [] })),
      ]);
      setBlocs(Array.isArray(b) ? b : []);
      setStudents(Array.isArray(s) ? s : []);
      setAcademic(a || { departments: [], programs: [] });
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load blocs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [showInactive]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return blocs;
    return blocs.filter((b) =>
      [b.name, b.description, b.course, b.yearLevel, b.section, b.departmentName, b.programName]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [blocs, search]);

  const programsForDept = (deptId) => {
    const did = Number(deptId || 0);
    if (!did) return academic.programs || [];
    return (academic.programs || []).filter((p) => Number(p.departmentId) === did);
  };

  function openCreate() {
    setModal({
      mode: 'create',
      bloc: null,
      form: {
        ...emptyBloc,
        departmentId: !isAdmin && user?.departmentId ? String(user.departmentId) : '',
        programId: !isAdmin && user?.programId ? String(user.programId) : '',
      },
      saving: false,
      error: '',
    });
  }

  function openEdit(bloc) {
    setModal({
      mode: 'edit',
      bloc,
      form: {
        name: bloc.name || '',
        description: bloc.description || '',
        course: bloc.course || '',
        yearLevel: bloc.yearLevel || '',
        section: bloc.section || '',
        departmentId: bloc.departmentId ? String(bloc.departmentId) : (!isAdmin && user?.departmentId ? String(user.departmentId) : ''),
        programId: bloc.programId ? String(bloc.programId) : (!isAdmin && user?.programId ? String(user.programId) : ''),
        active: Number(bloc.active) !== 0,
      },
      saving: false,
      error: '',
    });
  }

  async function saveBloc(e) {
    e?.preventDefault?.();
    if (!modal) return;
    const payload = {
      name: modal.form.name,
      description: modal.form.description || null,
      course: modal.form.course || null,
      yearLevel: modal.form.yearLevel || null,
      section: modal.form.section || null,
      departmentId: modal.form.departmentId ? Number(modal.form.departmentId) : null,
      programId: modal.form.programId ? Number(modal.form.programId) : null,
      active: !!modal.form.active,
    };
    setModal((m) => ({ ...m, saving: true, error: '' }));
    try {
      if (modal.mode === 'edit') await api.updateBloc(modal.bloc.id, payload);
      else await api.createBloc(payload);
      setModal(null);
      setToast(modal.mode === 'edit' ? 'Bloc updated' : 'Bloc created');
      setTimeout(() => setToast(''), 2000);
      await load();
    } catch (err) {
      setModal((m) => ({ ...m, saving: false, error: err.message || 'Unable to save bloc' }));
    }
  }

  async function removeBloc(bloc) {
    const ok = await confirm({
      title: 'Delete bloc?',
      message: `Delete "${bloc.name}"? Member assignments will be removed (events/attendance are not changed).`,
      confirmLabel: 'Delete bloc',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteBloc(bloc.id);
      setToast('Bloc deleted');
      setTimeout(() => setToast(''), 2000);
      await load();
    } catch (e) {
      await notify({ title: 'Delete failed', message: e.message || 'Unable to delete bloc.' });
    }
  }

  async function openMembers(bloc) {
    setMembersModal({ bloc, members: [], loading: true, search: '', section: '', selected: new Set(), saving: false, error: '' });
    try {
      const res = await api.getBlocMembers(bloc.id);
      setMembersModal((m) => m ? ({ ...m, loading: false, members: res.members || [], bloc: res.bloc || bloc }) : m);
    } catch (e) {
      setMembersModal((m) => m ? ({ ...m, loading: false, error: e.message || 'Failed to load members' }) : m);
    }
  }

  const memberIdsSet = useMemo(() => new Set((membersModal?.members || []).map((m) => Number(m.studentId))), [membersModal?.members]);

  const availableStudents = useMemo(() => {
    if (!membersModal) return [];
    const q = membersModal.search.trim().toLowerCase();
    const sec = membersModal.section;
    return students.filter((s) => {
      if (memberIdsSet.has(Number(s.id))) return false;
      if (sec && String(s.section || '') !== sec) return false;
      if (!q) return true;
      return [s.studentNo, s.firstName, s.lastName, s.course, s.section, s.yearLevel]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [students, membersModal, memberIdsSet]);

  const availableSections = useMemo(() => {
    const set = new Set(students.map((s) => String(s.section || '').trim()).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [students]);

  function toggleMemberSelect(id) {
    setMembersModal((m) => {
      if (!m) return m;
      const next = new Set(m.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...m, selected: next };
    });
  }

  async function addSelectedMembers(ids = null) {
    if (!membersModal) return;
    const studentIds = ids || [...membersModal.selected];
    if (!studentIds.length) return;
    setMembersModal((m) => ({ ...m, saving: true, error: '' }));
    try {
      const res = await api.addBlocMembers(membersModal.bloc.id, studentIds);
      setMembersModal((m) => m ? ({ ...m, saving: false, members: res.members || [], bloc: res.bloc || m.bloc, selected: new Set(), error: res.rejectedCount ? `${res.rejectedCount} student(s) skipped (outside bloc/scope or ineligible).` : '' }) : m);
      setToast(`Added ${res.added || 0} student(s)`);
      setTimeout(() => setToast(''), 2000);
      await load();
    } catch (e) {
      setMembersModal((m) => m ? ({ ...m, saving: false, error: e.message || 'Unable to add members' }) : m);
    }
  }

  async function removeMember(studentId) {
    if (!membersModal) return;
    setMembersModal((m) => ({ ...m, saving: true, error: '' }));
    try {
      const res = await api.removeBlocMembers(membersModal.bloc.id, [studentId]);
      setMembersModal((m) => m ? ({ ...m, saving: false, members: res.members || [], bloc: res.bloc || m.bloc }) : m);
      await load();
    } catch (e) {
      setMembersModal((m) => m ? ({ ...m, saving: false, error: e.message || 'Unable to remove member' }) : m);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Directory"
        title="Blocs"
        subtitle="Create and manage reusable student blocs/sections. Add bloc members and apply them to event attendance rosters with ease."
        actions={<button className="btn btn-primary" onClick={openCreate}>New bloc</button>}
      />

      {error && <div className="alert alert-error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {!isAdmin && scopedLock && (
        <div className="alert alert-info">
          Showing and managing blocs within your assigned scope: <strong>{user?.departmentName || 'Department'}</strong>{user?.programName ? ` · ${user.programName}` : ''}.
        </div>
      )}

      <div className="toolbar">
        <input className="search" placeholder="Search blocs, department, program, section…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="checkbox" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
      </div>

      {loading ? <Spinner /> : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Bloc</th>
                <th>Scope</th>
                <th>Course / Year / Section</th>
                <th>Members</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} className="muted center">No blocs found.</td></tr>}
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div className="strong">{b.name}</div>
                    {b.description ? <div className="muted small">{b.description}</div> : null}
                  </td>
                  <td>
                    {(b.departmentName || b.programName)
                      ? <span className="pill pill-amber">{b.programName || b.departmentName}</span>
                      : <span className="pill pill-gray">Unscoped</span>}
                    {b.departmentName && b.programName ? <div className="muted small">{b.departmentName}</div> : null}
                  </td>
                  <td>{[b.course, b.yearLevel, b.section].filter(Boolean).join(' · ') || '—'}</td>
                  <td><strong>{b.memberCount ?? 0}</strong></td>
                  <td>{Number(b.active) ? <span className="pill pill-green">Active</span> : <span className="pill pill-gray">Inactive</span>}</td>
                  <td className="right">
                    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => openMembers(b)}>Members</button>
                      <button className="btn btn-sm" onClick={() => openEdit(b)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeBloc(b)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal
          wide
          title={modal.mode === 'edit' ? 'Edit bloc' : 'New bloc'}
          onClose={() => !modal.saving && setModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)} disabled={modal.saving}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBloc} disabled={modal.saving}>{modal.saving ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <form className="form grid-form" onSubmit={saveBloc}>
            <label className="span-2">
              <span>Bloc name <span className="req">*</span></span>
              <input value={modal.form.name} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, name: e.target.value } }))} placeholder="e.g. BSIT 3A" required />
            </label>
            <label className="span-2">
              Description
              <textarea rows={3} value={modal.form.description} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, description: e.target.value } }))} />
            </label>
            <label>
              Department / College
              <select
                value={modal.form.departmentId}
                disabled={scopedLock && !!user?.departmentId}
                onChange={(e) => {
                  const did = e.target.value;
                  const ok = programsForDept(did).some((p) => String(p.id) === String(modal.form.programId));
                  setModal((m) => ({ ...m, form: { ...m.form, departmentId: did, programId: ok ? m.form.programId : '' } }));
                }}
              >
                <option value="">{isAdmin ? 'Unscoped / Global' : '—'}</option>
                {(academic.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              Program
              <select
                value={modal.form.programId}
                disabled={(scopedLock && !!user?.programId) || !modal.form.departmentId}
                onChange={(e) => {
                  const pid = e.target.value;
                  const prog = (academic.programs || []).find((p) => String(p.id) === pid);
                  setModal((m) => ({ ...m, form: { ...m.form, programId: pid, departmentId: prog ? String(prog.departmentId) : m.form.departmentId } }));
                }}
              >
                <option value="">{modal.form.departmentId ? 'All programs in college' : 'Select a college first'}</option>
                {programsForDept(modal.form.departmentId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>
              Course label
              <input value={modal.form.course} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, course: e.target.value } }))} placeholder="Optional" />
            </label>
            <label>
              Year level
              <input value={modal.form.yearLevel} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, yearLevel: e.target.value } }))} placeholder="Optional" />
            </label>
            <label>
              Section
              <input value={modal.form.section} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, section: e.target.value } }))} placeholder="Optional" />
            </label>
            <label className="checkbox" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={!!modal.form.active} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, active: e.target.checked } }))} />
              <span>Active bloc</span>
            </label>
            {modal.error && <div className="alert alert-error span-2">{modal.error}</div>}
          </form>
        </Modal>
      )}

      {membersModal && (
        <Modal
          wide
          title={`Members — ${membersModal.bloc?.name || 'Bloc'}`}
          onClose={() => !membersModal.saving && setMembersModal(null)}
          footer={<button className="btn" onClick={() => setMembersModal(null)} disabled={membersModal.saving}>Close</button>}
        >
          {membersModal.loading ? <Spinner /> : (
            <div className="grid-2" style={{ gap: '1rem', alignItems: 'start' }}>
              <div className="card">
                <h4 style={{ marginTop: 0 }}>Add students to bloc</h4>
                <p className="muted small">Select students to register/add to this bloc. Scoped/eligible students only.</p>
                <div className="toolbar" style={{ marginBottom: '0.5rem' }}>
                  <input className="search" placeholder="Search students…" value={membersModal.search} onChange={(e) => setMembersModal((m) => ({ ...m, search: e.target.value }))} />
                  <select value={membersModal.section} onChange={(e) => setMembersModal((m) => ({ ...m, section: e.target.value }))}>
                    <option value="">All sections</option>
                    {availableSections.map((sec) => <option key={sec} value={sec}>{sec}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <button className="btn btn-sm btn-primary" disabled={membersModal.saving || membersModal.selected.size === 0} onClick={() => addSelectedMembers()}>
                    Add selected ({membersModal.selected.size})
                  </button>
                  <button className="btn btn-sm" disabled={membersModal.saving || availableStudents.length === 0} onClick={() => addSelectedMembers(availableStudents.map((s) => s.id))}>
                    Add all shown ({availableStudents.length})
                  </button>
                </div>
                <div className="card table-card" style={{ maxHeight: 360, overflow: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr><th></th><th>Student No</th><th>Name</th><th>Section</th></tr>
                    </thead>
                    <tbody>
                      {availableStudents.length === 0 && <tr><td colSpan={4} className="muted center">No eligible students to add.</td></tr>}
                      {availableStudents.slice(0, 200).map((s) => (
                        <tr key={s.id}>
                          <td><input type="checkbox" checked={membersModal.selected.has(s.id)} onChange={() => toggleMemberSelect(s.id)} /></td>
                          <td className="mono">{s.studentNo}</td>
                          <td>{displayName(s)}</td>
                          <td>{s.section || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {availableStudents.length > 200 && <div className="muted small" style={{ padding: '0.5rem' }}>Showing first 200 results. Use search/section filter.</div>}
                </div>
              </div>

              <div className="card">
                <h4 style={{ marginTop: 0 }}>Current members ({membersModal.members.length})</h4>
                <p className="muted small">These students will be added to an event roster when this bloc is applied.</p>
                <div className="card table-card" style={{ maxHeight: 420, overflow: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr><th>Student No</th><th>Name</th><th>Course/Section</th><th></th></tr>
                    </thead>
                    <tbody>
                      {membersModal.members.length === 0 && <tr><td colSpan={4} className="muted center">No members yet.</td></tr>}
                      {membersModal.members.map((m) => (
                        <tr key={m.studentId}>
                          <td className="mono">{m.studentNo}</td>
                          <td>{displayName(m)}</td>
                          <td>{[m.course, m.section].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="right"><button className="btn btn-sm btn-danger" disabled={membersModal.saving} onClick={() => removeMember(m.studentId)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {membersModal.error && <div className="alert alert-error span-2" style={{ gridColumn: '1 / -1' }}>{membersModal.error}</div>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
