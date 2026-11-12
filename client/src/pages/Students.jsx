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

const STUDENT_STATUSES = ['Active', 'Inactive', 'Deceased', 'Dropped', 'Regular', 'Irregular'];
const STATUS_META = {
  Active: { pill: 'pill-green', icon: '●' },
  Regular: { pill: 'pill-blue', icon: '●' },
  Irregular: { pill: 'pill-amber', icon: '●' },
  Inactive: { pill: 'pill-gray', icon: '○' },
  Dropped: { pill: 'pill-red', icon: '■' },
  Deceased: { pill: 'pill-purple', icon: '◆' },
};

const emptyForm = { studentNo: '', firstName: '', lastName: '', email: '', course: '', yearLevel: '', section: '', status: 'Active' };

const COLUMNS = [
  { key: 'studentNo', label: 'Student No', get: (s) => s.studentNo || '' },
  { key: 'name', label: 'Name', get: (s) => `${s.lastName || ''} ${s.firstName || ''}` },
  { key: 'status', label: 'Status', get: (s) => s.status || 'Active' },
  { key: 'course', label: 'Course', get: (s) => s.course || '' },
  { key: 'yearLevel', label: 'Year', get: (s) => s.yearLevel || '' },
  { key: 'section', label: 'Section', get: (s) => s.section || '' },
  { key: 'email', label: 'Email', get: (s) => s.email || '' },
];

const PAGE_SIZES = [10, 25, 50, 100];

function StatusBadge({ status }) {
  const value = STUDENT_STATUSES.includes(status) ? status : 'Active';
  const meta = STATUS_META[value] || STATUS_META.Active;
  return (
    <span className={`pill ${meta.pill}`} title={`Status: ${value}`}>
      <span aria-hidden="true" style={{ marginRight: '0.35rem', fontSize: '0.7em', lineHeight: 1 }}>{meta.icon}</span>
      {value}
    </span>
  );
}

export default function Students() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
  const [bulkForm, setBulkForm] = useState({ course: '', yearLevel: '', section: '', status: '' });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('student');

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STUDENT_STATUSES.map((s) => [s, 0]));
    for (const s of students) {
      const key = STUDENT_STATUSES.includes(s.status) ? s.status : 'Active';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [students]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return students;
    return students.filter((s) => (s.status || 'Active') === statusFilter);
  }, [students, statusFilter]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[1];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * dir;
    });
  }, [filtered, sort]);

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
  }, [search, sort, pageSize, statusFilter]);

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
    setForm({ ...emptyForm, status: 'Active' });
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
      status: s.status || 'Active',
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
    setBulkForm({ course: '', yearLevel: '', section: '', status: '' });
    setBulkError('');
    setBulkEditOpen(true);
  }

  async function saveBulkEdit(e) {
    e.preventDefault();
    const patch = {};
    for (const key of ['course', 'yearLevel', 'section', 'status']) {
      const value = String(bulkForm[key] || '').trim();
      if (value) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      setBulkError('Enter a course, year level, section, or status to set. Blank fields leave existing values untouched.');
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
  const activeCount = (statusCounts.Active || 0) + (statusCounts.Regular || 0);

  return (
    <div className="page students-page">
      <PageHeader
        eyebrow="Student directory"
        title="Students"
        subtitle={`${total} student${total === 1 ? '' : 's'} shown${statusFilter !== 'all' ? ` · ${statusFilter}` : ''}${search ? ' · matching search' : ''}`}
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
        <StatCard icon="users" accent="blue" label="Total students" value={students.length} hint="In directory (current search)" />
        <StatCard icon="live" accent="green" label="Active / Regular" value={activeCount} hint="Currently active enrollment" />
        <StatCard icon="book" accent="purple" label="Courses" value={courseCount} hint="Distinct courses" />
        <StatCard icon="layers" accent="amber" label="Sections" value={sectionCount} hint={`${yearCount} year level${yearCount === 1 ? '' : 's'}`} />
      </div>

      <div className="card students-controls">
        <div className="toolbar students-toolbar" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            className="search"
            placeholder="Search by name, student no, course, section, email, or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="page-size">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s} ({statusCounts[s] || 0})</option>
              ))}
            </select>
          </label>
          <label className="page-size">
            Rows
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All <span className="muted small">({students.length})</span>
          </button>
          {STUDENT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : ''}`}
              onClick={() => setStatusFilter(s)}
              title={`Show ${s} students`}
            >
              {s} <span className="muted small">({statusCounts[s] || 0})</span>
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="events-bulk-bar students-bulk-bar" style={{ marginTop: '0.75rem' }}>
            <div className="events-bulk-info">
              <span className="events-bulk-count">{selected.size}</span>
              <span>student{selected.size === 1 ? '' : 's'} selected</span>
            </div>
            <div className="events-bulk-actions">
              {!allMatchingSelected && total > selected.size && (
                <button className="btn btn-sm" onClick={toggleSelectAllMatching}>Select all {total}</button>
              )}
              <button className="btn btn-sm" onClick={openBulkEdit}>Bulk edit</button>
              {isAdmin && (
                <button className="btn btn-sm" onClick={regenerateSelected} disabled={regenBusy}>
                  {regenBusy ? 'Working…' : 'Regenerate QR'}
                </button>
              )}
              {isAdmin && <button className="btn btn-sm btn-danger" onClick={bulkRemove}>Delete</button>}
              <button className="btn btn-sm btn-ghost-light" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card table-card students-table-card">
        <div className="students-table-head">
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Student directory</h3>
            <p className="muted small" style={{ margin: '0.15rem 0 0' }}>
              {loading ? 'Loading…' : `${pageRows.length} shown on this page · ${total} result${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <label className="events-select-all" style={{ margin: 0 }}>
            <input type="checkbox" aria-label="Select all on this page" checked={allPageSelected} onChange={toggleSelectPage} />
            <span>Select page</span>
          </label>
        </div>
        <div className="scroll-x">
          <table className="table students-table">
            <thead>
              <tr>
                <th className="check-col"></th>
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
                <tr><td colSpan={9} className="center"><Spinner label="Loading students…" size="sm" variant="center" /></td></tr>
              )}
              {!loading && total === 0 && (
                <tr>
                  <td colSpan={9} className="muted center" style={{ padding: '2rem 1rem' }}>
                    <div style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>No students found</div>
                    <div className="small">Try adjusting your search or status filter, or add students.</div>
                  </td>
                </tr>
              )}
              {pageRows.map((s) => {
                const status = s.status || 'Active';
                const inactiveLike = ['Inactive', 'Deceased', 'Dropped'].includes(status);
                return (
                  <tr key={s.id} className={`${selected.has(s.id) ? 'row-selected' : ''} ${inactiveLike ? 'row-muted' : ''}`}>
                    <td className="check-col">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} aria-label={`Select ${s.firstName} ${s.lastName}`} />
                    </td>
                    <td className="mono">{s.studentNo}</td>
                    <td>
                      <div className="name-cell">
                        <span className="mini-avatar">{(s.firstName?.[0] || '') + (s.lastName?.[0] || '')}</span>
                        <div>
                          <div className="strong">{s.lastName}, {s.firstName}</div>
                          <div className="muted small">{[s.course, s.section].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td><StatusBadge status={status} /></td>
                    <td>{s.course || <span className="muted">—</span>}</td>
                    <td>{s.yearLevel || <span className="muted">—</span>}</td>
                    <td>{s.section || <span className="muted">—</span>}</td>
                    <td className="muted">{s.email || '—'}</td>
                    <td className="right actions">
                      <button className="btn btn-sm" onClick={() => setQrStudent(s)}>QR</button>
                      <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          wide
          title={editing.id ? 'Edit Student' : 'Add Student'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save student'}
              </button>
            </>
          }
        >
          <form className="form event-form" onSubmit={save}>
            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Student information</h4>
                <p className="muted small">Identity, enrollment details, and current student status.</p>
              </div>
              <div className="form grid-form">
                <label>
                  <span>Student No <span className="req">*</span></span>
                  <input value={form.studentNo} onChange={(e) => setForm({ ...form, studentNo: e.target.value })} required />
                </label>
                <label>
                  <span>Email</span>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="optional" />
                </label>
                <label>
                  <span>First Name <span className="req">*</span></span>
                  <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
                </label>
                <label>
                  <span>Last Name <span className="req">*</span></span>
                  <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
                </label>
                <label>
                  <span>Status <span className="req">*</span></span>
                  <select value={form.status || 'Active'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>
                  <span>Course</span>
                  <input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="e.g. BSIT" />
                </label>
                <label>
                  <span>Year Level</span>
                  <input value={form.yearLevel} onChange={(e) => setForm({ ...form, yearLevel: e.target.value })} placeholder="e.g. 1st Year" />
                </label>
                <label>
                  <span>Section</span>
                  <input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" />
                </label>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <StatusBadge status={form.status || 'Active'} />
              </div>
            </section>
            {formError && <div className="alert alert-error">{formError}</div>}
          </form>
        </Modal>
      )}

      {bulkEditOpen && (
        <Modal
          wide
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
          <form className="form event-form" onSubmit={saveBulkEdit}>
            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Update selected students</h4>
                <p className="muted small">Only filled-in fields are changed. Blank fields keep each student's current value.</p>
              </div>
              <div className="form grid-form">
                <label>
                  <span>Course</span>
                  <input
                    value={bulkForm.course}
                    onChange={(e) => setBulkForm({ ...bulkForm, course: e.target.value })}
                    placeholder="Leave blank to keep"
                  />
                </label>
                <label>
                  <span>Year Level</span>
                  <input
                    value={bulkForm.yearLevel}
                    onChange={(e) => setBulkForm({ ...bulkForm, yearLevel: e.target.value })}
                    placeholder="Leave blank to keep"
                  />
                </label>
                <label>
                  <span>Section</span>
                  <input
                    value={bulkForm.section}
                    onChange={(e) => setBulkForm({ ...bulkForm, section: e.target.value })}
                    placeholder="Leave blank to keep"
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select value={bulkForm.status} onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })}>
                    <option value="">Leave blank to keep</option>
                    {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
            </section>
            {bulkError && <div className="alert alert-error">{bulkError}</div>}
          </form>
        </Modal>
      )}

      {bulkOpen && (
        <BulkAddStudents
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); load(); }}
        />
      )}

      {qrStudent && (
        <StudentQrModal
          student={qrStudent}
          onClose={() => setQrStudent(null)}
          onRegenerate={async () => {
            try {
              const updated = await api.regenerateStudentQr(qrStudent.id);
              setQrStudent(updated);
              await load();
            } catch (e) {
              alert(e.message);
            }
          }}
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
        <div style={{ marginTop: '0.5rem' }}><StatusBadge status={student.status} /></div>
      </div>
      <p className="muted small center">
        ID size 85.6 × 54 mm. Have the student present this card — staff scan the QR at the event to record attendance.
      </p>
    </Modal>
  );
}
