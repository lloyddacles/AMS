import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { composeIdCard } from '../idCard.js';
import Modal from '../components/Modal.jsx';
import BulkAddStudents from '../components/BulkAddStudents.jsx';
import StudentIdCard from '../components/StudentIdCard.jsx';
import Spinner from '../components/Spinner.jsx';

const emptyForm = { studentNo: '', firstName: '', lastName: '', email: '', course: '', yearLevel: '', section: '' };

const COLUMNS = [
  { key: 'studentNo', label: 'Student No', get: (s) => s.studentNo || '' },
  { key: 'name', label: 'Name', get: (s) => `${s.lastName || ''} ${s.firstName || ''}` },
  { key: 'course', label: 'Course', get: (s) => s.course || '' },
  { key: 'yearLevel', label: 'Year', get: (s) => s.yearLevel || '' },
  { key: 'section', label: 'Section', get: (s) => s.section || '' },
  { key: 'email', label: 'Email', get: (s) => s.email || '' },
];

const PAGE_SIZES = [10, 25, 50, 100];

export default function Students() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [qrStudent, setQrStudent] = useState(null);
  const [formError, setFormError] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[1];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...students].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * dir;
    });
  }, [students, sort]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sorted, currentPage, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [search, sort, pageSize]);

  async function load(q = search) {
    setLoading(true);
    try {
      setStudents(await api.getStudents(q));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function openCreate() {
    setEditing({});
    setForm(emptyForm);
    setFormError('');
  }

  function openEdit(s) {
    setEditing(s);
    setForm({
      studentNo: s.studentNo,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email || '',
      course: s.course || '',
      yearLevel: s.yearLevel || '',
      section: s.section || '',
    });
    setFormError('');
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editing?.id) await api.updateStudent(editing.id, form);
      else await api.createStudent(form);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    if (!confirm(`Delete ${s.firstName} ${s.lastName}? Their attendance records will also be removed.`)) return;
    try {
      await api.deleteStudent(s.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Students</h2>
          <p className="muted">{students.length} student{students.length === 1 ? '' : 's'}</p>
        </div>
        <div className="head-actions">
          <Link className="btn" to="/students/qr-sheet">Print ID Cards</Link>
          <button className="btn" onClick={() => setBulkOpen(true)}>Bulk Add</button>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Student</button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search by name, student no, or course…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="toolbar-right">
          <label className="page-size">
            Rows
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key}>
                  <button
                    type="button"
                    className={`sortable ${sort.key === c.key ? 'active' : ''}`}
                    onClick={() => toggleSort(c.key)}
                    title={`Sort by ${c.label}`}
                  >
                    {c.label}
                    <span className="sort-arrow">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
              ))}
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && students.length === 0 && (
              <tr><td colSpan={7} className="center"><Spinner label="Loading students…" size="sm" variant="center" /></td></tr>
            )}
            {!loading && students.length === 0 && (
              <tr><td colSpan={7} className="muted center">No students found.</td></tr>
            )}
            {pageRows.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.studentNo}</td>
                <td className="strong">{s.lastName}, {s.firstName}</td>
                <td>{s.course || '—'}</td>
                <td>{s.yearLevel || '—'}</td>
                <td>{s.section || '—'}</td>
                <td className="muted">{s.email || '—'}</td>
                <td className="right actions">
                  <button className="btn btn-sm" onClick={() => setQrStudent(s)}>QR</button>
                  <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="pagination">
          <span className="muted small">
            Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, total)} of {total}
          </span>
          <div className="pager">
            <button className="btn btn-sm" onClick={() => setPage(1)} disabled={currentPage === 1}>« First</button>
            <button className="btn btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>‹ Prev</button>
            <span className="pager-info">Page {currentPage} of {pageCount}</span>
            <button className="btn btn-sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount}>Next ›</button>
            <button className="btn btn-sm" onClick={() => setPage(pageCount)} disabled={currentPage === pageCount}>Last »</button>
          </div>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit Student' : 'Add Student'}
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
            <label>
              Student No *
              <input value={form.studentNo} onChange={(e) => setForm({ ...form, studentNo: e.target.value })} required />
            </label>
            <label>
              First Name *
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </label>
            <label>
              Last Name *
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Course
              <input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} />
            </label>
            <label>
              Year Level
              <input value={form.yearLevel} onChange={(e) => setForm({ ...form, yearLevel: e.target.value })} />
            </label>
            <label>
              Section
              <input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" />
            </label>
            {formError && <div className="alert alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}

      {qrStudent && <StudentQrModal student={qrStudent} onClose={() => setQrStudent(null)} onRegenerate={async () => {
        try {
          const updated = await api.regenerateStudentQr(qrStudent.id);
          setQrStudent(updated);
          await load();
        } catch (e) { alert(e.message); }
      }} />}

      {bulkOpen && (
        <BulkAddStudents
          onClose={() => setBulkOpen(false)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}

function StudentQrModal({ student, onClose, onRegenerate }) {
  const wrapRef = useRef(null);

  function download() {
    const qrCanvas = wrapRef.current?.querySelector('.id-card canvas');
    if (!qrCanvas) return;
    const cardCanvas = composeIdCard(student, qrCanvas);
    const url = cardCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${student.studentNo}-id-card.png`;
    a.click();
  }

  return (
    <Modal
      title="Student ID Card"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onRegenerate}>Regenerate QR</button>
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" onClick={download}>Download PNG</button>
        </>
      }
    >
      <div className="qr-display" ref={wrapRef}>
        <StudentIdCard student={student} />
      </div>
      <p className="muted small center">
        ID size 85.6 × 54 mm. Have the student present this card — staff scan the QR at the event to record attendance.
      </p>
    </Modal>
  );
}
