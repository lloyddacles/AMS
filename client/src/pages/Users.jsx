import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyForm = { username: '', password: '', name: '', role: 'staff' };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pwUser, setPwUser] = useState(null);
  const [newPw, setNewPw] = useState('');

  async function load() {
    setLoading(true);
    try {
      setUsers(await api.getUsers());
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

  function openEdit(u) {
    setEditing(u);
    setForm({ username: u.username, password: '', name: u.name, role: u.role });
    setFormError('');
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editing?.id) {
        await api.updateUser(editing.id, { name: form.name, role: form.role });
      } else {
        await api.createUser(form);
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Staff &amp; Admins</h2>
          <p className="muted">Accounts that can sign in to AttendX.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Add account</button>
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
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="strong">
                    {u.name}{Number(u.id) === Number(me?.id) && <span className="pill pill-blue" style={{ marginLeft: '0.5rem' }}>you</span>}
                  </td>
                  <td className="mono">{u.username}</td>
                  <td><span className={`pill ${u.role === 'admin' ? 'pill-purple' : 'pill-gray'}`}>{u.role}</span></td>
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
            {formError && <div className="alert alert-error span-2">{formError}</div>}
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
