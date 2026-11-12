import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyForm = { username: '', password: '', name: '', role: 'staff', departmentId: '', programId: '' };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [structure, setStructure] = useState({ departments: [], programs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pwUser, setPwUser] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [progOpen, setProgOpen] = useState(false);
  const [progForm, setProgForm] = useState({ departmentId: '', name: '', code: '' });
  const [progSaving, setProgSaving] = useState(false);
  const [progError, setProgError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([api.getUsers(), api.getAcademicStructure().catch(() => ({ departments: [], programs: [] }))]);
      setUsers(u);
      setStructure(s || { departments: [], programs: [] });
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
    const deptId = Number(form.departmentId || 0);
    if (!deptId) return structure.programs || [];
    return (structure.programs || []).filter((p) => Number(p.departmentId) === deptId);
  }, [structure.programs, form.departmentId]);

  function openCreate() {
    setEditing({});
    setForm({ ...emptyForm });
    setFormError('');
  }

  function openEdit(u) {
    setEditing(u);
    setForm({
      username: u.username || '',
      password: '',
      name: u.name || '',
      role: u.role || 'staff',
      departmentId: u.departmentId ? String(u.departmentId) : '',
      programId: u.programId ? String(u.programId) : '',
    });
    setFormError('');
  }

  function onDepartmentChange(departmentId) {
    const deptId = String(departmentId || '');
    const deptPrograms = (structure.programs || []).filter((p) => String(p.departmentId) === deptId);
    const keepProgram = deptPrograms.some((p) => String(p.id) === String(form.programId));
    setForm((f) => ({ ...f, departmentId: deptId, programId: keepProgram ? f.programId : '' }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name,
        role: form.role,
        departmentId: form.departmentId || null,
        programId: form.programId || null,
      };
      if (editing?.id) {
        await api.updateUser(editing.id, payload);
      } else {
        await api.createUser({
          username: form.username,
          password: form.password,
          name: form.name,
          role: form.role,
          departmentId: form.departmentId || null,
          programId: form.programId || null,
        });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u) {
    const verb = Number(u.active) ? 'Deactivate' : 'Activate';
    if (!confirm(`${verb} ${u.name}?`)) return;
    try {
      await api.updateUser(u.id, { active: !Number(u.active) });
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function remove(u) {
    if (!confirm(`Delete ${u.name}? This cannot be undone.`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    try {
      await api.resetUserPassword(pwUser.id, newPw);
      setPwUser(null);
      setNewPw('');
      alert('Password updated');
    } catch (err) {
      alert(err.message);
    }
  }

  async function saveProgram(e) {
    e.preventDefault();
    setProgSaving(true);
    setProgError('');
    try {
      await api.createProgram({
        departmentId: progForm.departmentId,
        name: progForm.name,
        code: progForm.code,
      });
      const s = await api.getAcademicStructure();
      setStructure(s || { departments: [], programs: [] });
      setProgForm({ departmentId: progForm.departmentId, name: '', code: '' });
      setProgOpen(false);
    } catch (err) {
      setProgError(err.message);
    } finally {
      setProgSaving(false);
    }
  }

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const staffCount = users.filter((u) => u.role === 'staff').length;
  const activeCount = users.filter((u) => Number(u.active)).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Access control"
        title="Staff &amp; Admins"
        subtitle="Accounts that can sign in to AttendX. Assign staff to a department/program to limit student visibility."
        actions={
          <>
            <button className="btn" onClick={() => { setProgError(''); setProgOpen(true); }}>+ Add Program</button>
            <button className="btn btn-primary" onClick={openCreate}>+ Add account</button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard icon="users" accent="blue" label="Accounts" value={users.length} hint="Total staff accounts" />
        <StatCard icon="shield" accent="purple" label="Admins" value={adminCount} hint="Full access" />
        <StatCard icon="key" accent="green" label="Staff" value={staffCount} hint="Attendance &amp; events" />
        <StatCard icon="check" accent="amber" label="Active" value={activeCount} hint="Can sign in" />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && users.length === 0 && <div className="card"><Spinner label="Loading users…" size="lg" variant="panel" /></div>}

      {!loading && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Department / Program</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="name-cell">
                      <span className="mini-avatar">{(u.name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('')}</span>
                      <span className="strong">
                        {u.name}
                        {Number(u.id) === Number(me?.id) && <span className="pill pill-blue" style={{ marginLeft: '0.5rem' }}>you</span>}
                      </span>
                    </div>
                  </td>
                  <td className="mono">{u.username}</td>
                  <td><span className={`pill ${u.role === 'admin' ? 'pill-purple' : 'pill-gray'}`}>{u.role}</span></td>
                  <td>
                    {u.role === 'admin' ? (
                      <span className="muted small">All departments</span>
                    ) : (u.departmentName || u.programName) ? (
                      <div>
                        <div className="small strong">{u.departmentName || '—'}</div>
                        <div className="muted small">{u.programName || 'All programs in department'}</div>
                      </div>
                    ) : (
                      <span className="pill pill-amber">Unassigned (can see all)</span>
                    )}
                  </td>
                  <td><span className={`pill ${Number(u.active) ? 'pill-green' : 'pill-red'}`}>{Number(u.active) ? 'active' : 'inactive'}</span></td>
                  <td className="right actions">
                    <button className="btn btn-sm" onClick={() => openEdit(u)}>Edit</button>
                    <button className="btn btn-sm" onClick={() => { setPwUser(u); setNewPw(''); }}>Password</button>
                    <button className="btn btn-sm" onClick={() => toggleActive(u)} disabled={Number(u.id) === Number(me?.id)}>
                      {Number(u.active) ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(u)} disabled={Number(u.id) === Number(me?.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit account' : 'Add account'}
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
              Full name *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            {!editing.id && (
              <>
                <label>
                  Username *
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" />
                </label>
                <label>
                  Password *
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} autoComplete="new-password" />
                </label>
              </>
            )}
            <label>
              Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff — attendance &amp; events</option>
                <option value="admin">Admin — full access</option>
              </select>
            </label>
            <label>
              Department
              <select value={form.departmentId} onChange={(e) => onDepartmentChange(e.target.value)} disabled={form.role === 'admin'}>
                <option value="">{form.role === 'admin' ? 'Not required (admin sees all)' : 'No department (unassigned)'}</option>
                {(structure.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="span-2">
              Program (optional)
              <select value={form.programId} onChange={(e) => setForm({ ...form, programId: e.target.value })} disabled={form.role === 'admin' || !form.departmentId}>
                <option value="">All programs in selected department</option>
                {programsForDept.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {form.role === 'staff' && (
              <div className="muted small span-2">
                Staff assigned to a department (and optional program) can only see students in that scope. Unassigned staff can currently see all students.
              </div>
            )}
            {formError && <div className="alert alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}

      {progOpen && (
        <Modal
          title="Add program"
          onClose={() => setProgOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setProgOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProgram} disabled={progSaving}>{progSaving ? 'Saving…' : 'Add program'}</button>
            </>
          }
        >
          <form className="form" onSubmit={saveProgram}>
            <label>
              Department *
              <select value={progForm.departmentId} onChange={(e) => setProgForm({ ...progForm, departmentId: e.target.value })} required>
                <option value="">Select department</option>
                {(structure.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              Program name *
              <input value={progForm.name} onChange={(e) => setProgForm({ ...progForm, name: e.target.value })} placeholder="e.g. Bachelor of Science in..." required />
            </label>
            <label>
              Code (optional)
              <input value={progForm.code} onChange={(e) => setProgForm({ ...progForm, code: e.target.value })} placeholder="e.g. BSCS" />
            </label>
            {progError && <div className="alert alert-error">{progError}</div>}
          </form>
        </Modal>
      )}

      {pwUser && (
        <Modal
          title={`Reset password — ${pwUser.name}`}
          onClose={() => setPwUser(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPwUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={savePassword}>Update password</button>
            </>
          }
        >
          <form className="form" onSubmit={savePassword}>
            <label>
              New password
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} minLength={6} required autoComplete="new-password" />
            </label>
            <p className="muted small">At least 6 characters. The user keeps their existing username.</p>
          </form>
        </Modal>
      )}
    </div>
  );
}
