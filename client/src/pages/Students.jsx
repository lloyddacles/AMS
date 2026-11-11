import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { composeIdCard } from '../idCard.js';
import Modal from '../components/Modal.jsx';
import BulkAddStudents from '../components/BulkAddStudents.jsx';
import StudentIdCard from '../components/StudentIdCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
  const [selected, setSelected] = useState(() => new Set());
  const [regenBusy, setRegenBusy] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ course: '', yearLevel: '', section: '' });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('student');

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

  const pageIds = pageRows.map((s) => s.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const allMatchingSelected = total > 0 && sorted.every((s) => selected.has(s.id));

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleSelectAllMatching() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allMatchingSelected) sorted.forEach((s) => next.delete(s.id));
      else sorted.forEach((s) => next.add(s.id));
      return next;
    });
  }

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(students.map((s) => s.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [students]);

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

  // Deep link from the command palette: /students?student=<id> opens the edit
  // modal for that student, then cleans the query string so closing it sticks.
  useEffect(() => {
    if (!focusId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const student = await api.getStudent(focusId);
        if (cancelled) return;
        openEdit(student);
        if (!students.some((s) => s.id === student.id)) setSearch('');
        const next = new URLSearchParams(searchParams);
        next.delete('student');
        setSearchParams(next, { replace: true });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

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

  async function regenerateSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Regenerate QR codes for ${ids.length} selected student(s)?\n\nTheir previously printed ID cards will stop working.`)) return;
    setRegenBusy(true);
    try {
      const res = await api.regenerateStudentQrBulk({ ids });
      setSelected(new Set());
      await load();
      alert(`Regenerated QR codes for ${res.count} student(s).`);
    } catch (e) {
      alert(e.message);
    } finally {
      setRegenBusy(false);
    }
  }

  async function regenerateAll() {
    if (!confirm('Regenerate QR codes for ALL students?\n\nEvery previously printed ID card will stop working.')) return;
    if (!confirm('This cannot be undone. Continue?')) return;
    setRegenBusy(true);
    try {
      const res = await api.regenerateStudentQrBulk({ all: true });
      setSelected(new Set());
      await load();
      alert(`Regenerated QR codes for ${res.count} student(s).`);
    } catch (e) {
      alert(e.message);
    } finally {
      setRegenBusy(false);
    }
  }

  function openBulkEdit() {
    setBulkForm({ course: '', yearLevel: '', section: '' });
    setBulkError('');
    setBulkEditOpen(true);
  }

  async function saveBulkEdit(e) {
    e.preventDefault();
    const patch = {};
    for (const key of ['course', 'yearLevel', 'section']) {
      const value = String(bulkForm[key] || '').trim();
      if (value) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      setBulkError('Enter a course, year level, or section to set. Blank fields leave existing values untouched.');
      return;
    }
    setBulkBusy(true);
    setBulkError('');
    try {
      const res = await api.bulkUpdateStudents([...selected], patch);
      setBulkEditOpen(false);
      setSelected(new Set());
      await load();
      alert(`Updated ${res.count} student(s).`);
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkRemove() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected student(s)?\n\nTheir attendance records will also be removed.`)) return;
    if (!confirm('This cannot be undone. Continue?')) return;
    try {
      const res = await api.bulkDeleteStudents(ids);
      setSelected(new Set());
      await load();
      alert(`Deleted ${res.count} student(s).`);
    } catch (e) {
      alert(e.message);
    }
  }

  const courseCount = new Set(students.map((s) => s.course).filter(Boolean)).size;
  const sectionCount = new Set(students.map((s) => s.section).filter(Boolean)).size;
  const yearCount = new Set(students.map((s) => s.yearLevel).filter(Boolean)).size;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Directory"
        title="Students"
        subtitle={`${students.length} student${students.length === 1 ? '' : 's'} in view`}
        actions={
          <>
            <Link className="btn" to="/students/qr-sheet">Print ID Cards</Link>
            <button className="btn" onClick={() => setBulkOpen(true)}>Bulk Add</button>
            {isAdmin && (
              <button className="btn" onClick={regenerateAll} disabled={regenBusy || students.length === 0}>
                {regenBusy ? 'Working…' : 'Regenerate All QR'}
              </button>
            )}
            <button className="btn btn-primary" onClick={openCreate}>+ Add Student</button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard icon="users" accent="blue" label="Students" value={students.length} hint="Matching current search" />
        <StatCard icon="book" accent="purple" label="Courses" value={courseCount} hint="Distinct courses" />
        <StatCard icon="layers" accent="green" label="Sections" value={sectionCount} hint="Distinct sections" />
        <StatCard icon="star" accent="amber" label="Year levels" value={yearCount} hint="Distinct year levels" />
      </div>

      <div className="filter-bar">
        <div className="toolbar">
          <input
            className="search"
            placeholder="Search by name, student no, or course…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="toolbar-right">
            {selected.size > 0 && (
              <div className="sel-actions">
                <span className="muted small">{selected.size} selected</span>
                {!allMatchingSelected && total > selected.size && (
                  <button className="btn btn-sm" onClick={toggleSelectAllMatching}>
                    Select all {total}
                  </button>
                )}
                <button className="btn btn-sm" onClick={openBulkEdit}>Bulk edit</button>
                {isAdmin && (
                  <button className="btn btn-sm" onClick={regenerateSelected} disabled={regenBusy}>
                    {regenBusy ? 'Working…' : 'Regenerate QR'}
                  </button>
                )}
                {isAdmin && (
                  <button className="btn btn-sm btn-danger" onClick={bulkRemove}>Delete</button>
                )}
                <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}
            <label className="page-size">
              Rows
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allPageSelected}
                  onChange={toggleSelectPage}
                />
              </th>
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
              <tr><td colSpan={8} className="center"><Spinner label="Loading students…" size="sm" variant="center" /></td></tr>
            )}
            {!loading && students.length === 0 && (
              <tr><td colSpan={8} className="muted center">No students found.</td></tr>
            )}
            {pageRows.map((s) => (
              <tr key={s.id} className={selected.has(s.id) ? 'row-selected' : ''}>
                <td className="check-col">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} aria-label={`Select ${s.firstName} ${s.lastName}`} />
                </td>
                <td className="mono">{s.studentNo}</td>
                <td>
                  <div className="name-cell">
                    <span className="mini-avatar">
                      {(s.firstName?.[0] || '') + (s.lastName?.[0] || '')}
                    </span>
                    <span className="strong">{s.lastName}, {s.firstName}</span>
                  </div>
                </td>
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

      {bulkEditOpen && (
        <Modal
          title={`Bulk edit ${selected.size} student${selected.size === 1 ? '' : 's'}`}
          onClose={() => setBulkEditOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setBulkEditOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBulkEdit} disabled={bulkBusy}>
                {bulkBusy ? 'Updating…' : 'Apply changes'}
              </button>
            </>
          }
        >
          <form className="form grid-form" onSubmit={saveBulkEdit}>
            <p className="muted small span-2">
              Only filled-in fields are changed. Blank fields keep each student's current value.
            </p>
            <label>
              Course
              <input
                value={bulkForm.course}
                onChange={(e) => setBulkForm({ ...bulkForm, course: e.target.value })}
                placeholder="Leave blank to keep"
              />
            </label>
            <label>
              Year Level
              <input
                value={bulkForm.yearLevel}
                onChange={(e) => setBulkForm({ ...bulkForm, yearLevel: e.target.value })}
                placeholder="Leave blank to keep"
              />
            </label>
            <label>
              Section
              <input
                value={bulkForm.section}
                onChange={(e) => setBulkForm({ ...bulkForm, section: e.target.value })}
                placeholder="Leave blank to keep"
              />
            </label>
            {bulkError && <div className="alert alert-error span-2">{bulkError}</div>}
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
