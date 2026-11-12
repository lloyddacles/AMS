import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useDialog } from '../dialogs.jsx';
import { composeIdCard } from '../idCard.js';
import Modal from '../components/Modal.jsx';
import BulkAddStudents from '../components/BulkAddStudents.jsx';
import StudentIdCard from '../components/StudentIdCard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';

const STUDENT_STATUSES = ['Active', 'Inactive', 'Deceased', 'Dropped', 'LOA', 'Regular', 'Irregular'];
const STATUS_META = {
  Active: { pill: 'pill-green', icon: '●' },
  Regular: { pill: 'pill-blue', icon: '●' },
  Irregular: { pill: 'pill-amber', icon: '●' },
  LOA: { pill: 'pill-amber', icon: '◐' },
  Inactive: { pill: 'pill-gray', icon: '○' },
  Dropped: { pill: 'pill-red', icon: '■' },
  Deceased: { pill: 'pill-purple', icon: '◆' },
};

const emptyForm = { studentNo: '', firstName: '', lastName: '', email: '', course: '', yearLevel: '', section: '', status: 'Active', programId: '' };

const SORT_COLUMNS = [
  { key: 'name', label: 'Student', get: (s) => `${s.lastName || ''} ${s.firstName || ''}`.trim() || s.studentNo || '' },
  { key: 'studentNo', label: 'Student No', get: (s) => s.studentNo || '' },
  { key: 'status', label: 'Status', get: (s) => s.status || 'Active' },
  { key: 'course', label: 'Course', get: (s) => s.course || '' },
];

const PAGE_SIZES = [10, 25, 50, 100];

function StatusBadge({ status }) {
  const value = STUDENT_STATUSES.includes(status) ? status : 'Active';
  const meta = STATUS_META[value] || STATUS_META.Active;
  return (
    <span className={`pill ${meta.pill} status-badge`} title={`Status: ${value}`}>
      <span aria-hidden="true" className="status-badge-dot">{meta.icon}</span>
      {value}
    </span>
  );
}

function programChipStyle(name = '') {
  const n = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (n.includes('entrepreneurship')) return { background: '#800000', color: '#ffffff', border: '1px solid #800000' }; // maroon
  if (n.includes('tourism management')) return { background: '#7e22ce', color: '#ffffff', border: '1px solid #7e22ce' }; // purple
  if (n.includes('criminology')) return { background: '#f97316', color: '#111827', border: '1px solid #ea580c' }; // orange
  if (n.includes('accounting information systems') || (n.includes('accountancy') && !n.includes('tourism'))) {
    return { background: '#facc15', color: '#422006', border: '1px solid #eab308' }; // yellow
  }
  if (n.includes('information systems')) return { background: '#1e3a8a', color: '#ffffff', border: '1px solid #1e3a8a' }; // navy blue
  return null;
}

function studentMeta(s) {
  const programOrCourse = s.programName || s.course || '';
  const yearSection = [s.yearLevel, s.section].filter(Boolean).join(' · ');
  const dept = s.departmentName || '';
  const programStyle = programChipStyle(programOrCourse);
  return { programOrCourse, yearSection, group: [programOrCourse, s.yearLevel, s.section].filter(Boolean).join(' · '), dept, email: s.email || '', programStyle };
}

export default function Students() {
  const { user } = useAuth();
  const { confirm, notify } = useDialog();
  const isAdmin = user?.role === 'admin';
  const [students, setStudents] = useState([]);
  const [academic, setAcademic] = useState({ departments: [], programs: [] });
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
  const [bulkForm, setBulkForm] = useState({ programId: '', course: '', yearLevel: '', section: '', status: '' });
  const [bulkDeptFilter, setBulkDeptFilter] = useState('');
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
    const col = SORT_COLUMNS.find((c) => c.key === sort.key) || SORT_COLUMNS[0];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = String(col.get(a) || '');
      const bv = String(col.get(b) || '');
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
    api.getAcademicStructure().then((s) => setAcademic(s || { departments: [], programs: [] })).catch(() => {});
  }, []);

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

  function onProgramChange(programId) {
    const pid = String(programId || '');
    const prog = (academic.programs || []).find((p) => String(p.id) === pid);
    setForm((f) => ({ ...f, programId: pid, course: prog ? prog.name : f.course }));
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
      programId: s.programId ? String(s.programId) : '',
    });
    setFormError('');
  }

  const selectedProgram = (academic.programs || []).find((p) => String(p.id) === String(form.programId || ''));
  const formDeptId = selectedProgram ? String(selectedProgram.departmentId) : '';
  const formPrograms = formDeptId
    ? (academic.programs || []).filter((p) => String(p.departmentId) === formDeptId)
    : (academic.programs || []);
  const bulkPrograms = bulkDeptFilter
    ? (academic.programs || []).filter((p) => String(p.departmentId) === String(bulkDeptFilter))
    : (academic.programs || []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editing?.id) await api.updateStudent(editing.id, form);
      else await api.createStudent(form);
      const wasEdit = Boolean(editing?.id);
      setEditing(null);
      await load();
      await notify({ title: wasEdit ? 'Student updated' : 'Student added', message: wasEdit ? 'Student details were saved successfully.' : 'The student was added successfully.' });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    const ok = await confirm({
      title: 'Delete student',
      message: `Delete ${s.firstName} ${s.lastName}? Their attendance records will also be removed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteStudent(s.id);
      await load();
      await notify({ title: 'Student deleted', message: `${s.firstName} ${s.lastName} was deleted successfully.` });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to delete the student.' });
    }
  }

  async function regenerateSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: 'Regenerate QR codes',
      message: `Regenerate QR codes for ${ids.length} selected student(s)?\n\nTheir previously printed ID cards will stop working.`,
      confirmLabel: 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    setRegenBusy(true);
    try {
      const res = await api.regenerateStudentQrBulk({ ids });
      setSelected(new Set());
      await load();
      await notify({ title: 'QR codes regenerated', message: `Regenerated QR codes for ${res.count} student(s).` });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to regenerate QR codes.' });
    } finally {
      setRegenBusy(false);
    }
  }

  async function regenerateAll() {
    const ok1 = await confirm({
      title: 'Regenerate all QR codes',
      message: 'Regenerate QR codes for ALL students?\n\nEvery previously printed ID card will stop working.',
      confirmLabel: 'Continue',
      danger: true,
    });
    if (!ok1) return;
    const ok2 = await confirm({ title: 'Confirm action', message: 'This cannot be undone. Continue?', confirmLabel: 'Regenerate all', danger: true });
    if (!ok2) return;
    setRegenBusy(true);
    try {
      const res = await api.regenerateStudentQrBulk({ all: true });
      setSelected(new Set());
      await load();
      await notify({ title: 'QR codes regenerated', message: `Regenerated QR codes for ${res.count} student(s).` });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to regenerate QR codes.' });
    } finally {
      setRegenBusy(false);
    }
  }

  function openBulkEdit() {
    setBulkForm({ programId: '', course: '', yearLevel: '', section: '', status: '' });
    setBulkDeptFilter('');
    setBulkError('');
    setBulkEditOpen(true);
  }

  async function saveBulkEdit(e) {
    e.preventDefault();
    const patch = {};
    for (const key of ['programId', 'course', 'yearLevel', 'section', 'status']) {
      const value = String(bulkForm[key] || '').trim();
      if (value) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      setBulkError('Select a program or enter a course, year level, section, or status to set. Blank fields leave existing values untouched.');
      return;
    }
    setBulkBusy(true);
    setBulkError('');
    try {
      const res = await api.bulkUpdateStudents([...selected], patch);
      setBulkEditOpen(false);
      setSelected(new Set());
      await load();
      await notify({ title: 'Students updated', message: `Updated ${res.count} student(s).` });
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkRemove() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok1 = await confirm({
      title: 'Delete selected students',
      message: `Delete ${ids.length} selected student(s)?\n\nTheir attendance records will also be removed.`,
      confirmLabel: 'Continue',
      danger: true,
    });
    if (!ok1) return;
    const ok2 = await confirm({ title: 'Confirm deletion', message: 'This cannot be undone. Continue?', confirmLabel: 'Delete', danger: true });
    if (!ok2) return;
    try {
      const res = await api.bulkDeleteStudents(ids);
      setSelected(new Set());
      await load();
      await notify({ title: 'Students deleted', message: `Deleted ${res.count} student(s).` });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to delete students.' });
    }
  }

  const courseCount = new Set(students.map((s) => s.programName || s.course).filter(Boolean)).size;
  const deptCount = new Set(students.map((s) => s.departmentName).filter(Boolean)).size;
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
        <StatCard icon="book" accent="purple" label="Programs / Courses" value={courseCount} hint={`${deptCount} department${deptCount === 1 ? '' : 's'} represented`} />
        <StatCard icon="layers" accent="amber" label="Sections" value={sectionCount} hint={`${yearCount} year level${yearCount === 1 ? '' : 's'}`} />
      </div>

      <div className="card students-controls students-controls-compact">
        <div className="students-controls-row">
          <input
            className="search students-search"
            placeholder="Search name, student no, course, section, email, or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="students-sort">
            <span>Sort</span>
            <select
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':');
                setSort({ key, dir });
              }}
            >
              {SORT_COLUMNS.flatMap((c) => ([
                <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} (A–Z)</option>,
                <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} (Z–A)</option>,
              ]))}
            </select>
          </label>
        </div>

        <div className="students-filter-chips" role="group" aria-label="Filter by status">
          <button
            type="button"
            className={`student-filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All <span>{students.length}</span>
          </button>
          {STUDENT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`student-filter-chip ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
              title={`Show ${s} students`}
            >
              {s} <span>{statusCounts[s] || 0}</span>
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="events-bulk-bar students-bulk-bar" style={{ marginTop: '0.6rem' }}>
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

      <div className="card table-card students-table-card students-compact-card">
        <div className="students-table-head compact">
          <div>
            <h3>Student directory</h3>
            <p className="muted small">
              {loading ? 'Loading…' : `${pageRows.length} shown · ${total} result${total === 1 ? '' : 's'}${statusFilter !== 'all' ? ` · ${statusFilter}` : ''}`}
            </p>
          </div>
          <div className="students-head-tools">
            <label className="events-select-all">
              <input type="checkbox" aria-label="Select all on this page" checked={allPageSelected} onChange={toggleSelectPage} />
              <span>Select page</span>
            </label>
          </div>
        </div>

        {loading && students.length === 0 ? (
          <div className="students-empty"><Spinner label="Loading students…" size="sm" variant="center" /></div>
        ) : !loading && total === 0 ? (
          <div className="students-empty muted center">
            <div style={{ fontSize: '1rem', marginBottom: '0.25rem', color: 'var(--text)' }}>No students found</div>
            <div className="small">Try adjusting your search or status filter, or add students.</div>
          </div>
        ) : (
          <div className="students-compact-list" role="table" aria-label="Student directory">
            <div className="students-compact-header" role="row">
              <div className="scol check" />
              <div className="scol student">
                <button type="button" className={`sortable ${sort.key === 'name' ? 'active' : ''}`} onClick={() => toggleSort('name')}>
                  Student <span className="sort-arrow">{sort.key === 'name' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                </button>
              </div>
              <div className="scol status">
                <button type="button" className={`sortable ${sort.key === 'status' ? 'active' : ''}`} onClick={() => toggleSort('status')}>
                  Status <span className="sort-arrow">{sort.key === 'status' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                </button>
              </div>
              <div className="scol actions right"><span className="muted">Actions</span></div>
            </div>
            {pageRows.map((s) => {
              const status = s.status || 'Active';
              const inactiveLike = ['Inactive', 'Deceased', 'Dropped', 'LOA'].includes(status);
              const meta = studentMeta(s);
              const fullName = `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, '').trim() || 'Unnamed student';
              return (
                <div
                  key={s.id}
                  role="row"
                  className={`students-compact-row ${selected.has(s.id) ? 'row-selected' : ''} ${inactiveLike ? 'row-muted' : ''}`}
                >
                  <div className="scol check" role="cell">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      aria-label={`Select ${s.firstName || ''} ${s.lastName || ''}`.trim()}
                    />
                  </div>
                  <div className="scol student" role="cell">
                    <span className="mini-avatar">{(s.firstName?.[0] || '') + (s.lastName?.[0] || '')}</span>
                    <div className="student-main">
                      <div className="student-line1">
                        <span className="strong student-name" title={meta.email || fullName}>{fullName}</span>
                        <span className="student-no mono">{s.studentNo || '—'}</span>
                      </div>
                      <div className="student-line2">
                        {meta.dept ? <span className="student-dept-chip" title={meta.dept}>{meta.dept}</span> : null}
                        {meta.programOrCourse ? (
                          <span
                            className={`program-chip${meta.programStyle ? '' : ' program-chip-default'}`}
                            style={meta.programStyle || undefined}
                            title={meta.programOrCourse}
                          >
                            {meta.programOrCourse}
                          </span>
                        ) : (
                          <span className="muted">No program/course set</span>
                        )}
                        {meta.yearSection ? <span>{meta.yearSection}</span> : null}
                        {meta.email ? <span className="student-meta-sep">•</span> : null}
                        {meta.email ? <span className="student-email" title={meta.email}>{meta.email}</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="scol status" role="cell"><StatusBadge status={status} /></div>
                  <div className="scol actions right" role="cell">
                    <button className="btn btn-sm" onClick={() => setQrStudent(s)}>QR</button>
                    <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="pagination students-pagination">
          <span className="muted small">
            Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, total)} of {total}
          </span>
          <div className="pager">
            <label className="page-size inline">
              <span>Rows</span>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
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
                  <span>Department</span>
                  <select
                    value={formDeptId}
                    onChange={(e) => {
                      const did = e.target.value;
                      const currentOk = (academic.programs || []).some((p) => String(p.id) === String(form.programId) && String(p.departmentId) === did);
                      if (!currentOk) setForm((f) => ({ ...f, programId: '', course: did ? f.course : f.course }));
                    }}
                  >
                    <option value="">All departments</option>
                    {(academic.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Program</span>
                  <select value={form.programId || ''} onChange={(e) => onProgramChange(e.target.value)}>
                    <option value="">No linked program</option>
                    {formPrograms.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="span-2">
                  <span>Course / Program Name</span>
                  <input
                    value={form.course}
                    onChange={(e) => setForm({ ...form, course: e.target.value })}
                    placeholder="Auto-filled from selected program, or enter manually"
                  />
                  <span className="muted small">Select a department and program to link the student correctly for staff scoping.</span>
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
                <h4>Assign department &amp; program</h4>
                <p className="muted small">Quickly assign selected students to the correct department/program for staff scoping. Blank fields keep existing values.</p>
              </div>
              <div className="form grid-form">
                <label>
                  <span>Department filter</span>
                  <select
                    value={bulkDeptFilter}
                    onChange={(e) => {
                      const did = e.target.value;
                      setBulkDeptFilter(did);
                      const list = did ? (academic.programs || []).filter((p) => String(p.departmentId) === String(did)) : (academic.programs || []);
                      const ok = list.some((p) => String(p.id) === String(bulkForm.programId));
                      if (!ok) setBulkForm((f) => ({ ...f, programId: '' }));
                    }}
                  >
                    <option value="">All departments</option>
                    {(academic.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Program (assign)</span>
                  <select
                    value={bulkForm.programId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const prog = (academic.programs || []).find((p) => String(p.id) === String(pid));
                      setBulkForm({ ...bulkForm, programId: pid, course: prog ? prog.name : bulkForm.course });
                    }}
                  >
                    <option value="">Leave blank to keep</option>
                    {bulkPrograms.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{!bulkDeptFilter ? ` — ${p.departmentName}` : ''}</option>
                    ))}
                  </select>
                </label>
                <label className="span-2">
                  <span>Course / Program Name</span>
                  <input
                    value={bulkForm.course}
                    onChange={(e) => setBulkForm({ ...bulkForm, course: e.target.value })}
                    placeholder="Auto-filled from selected program, or leave blank to keep"
                  />
                </label>
              </div>
            </section>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Other details (optional)</h4>
                <p className="muted small">Only filled-in fields are changed.</p>
              </div>
              <div className="form grid-form">
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
            const updated = await api.regenerateStudentQr(qrStudent.id);
            setQrStudent(updated);
            await load();
            return updated;
          }}
        />
      )}
    </div>
  );
}

function StudentQrModal({ student, onClose, onRegenerate }) {
  const { confirm, notify } = useDialog();
  const wrapRef = useRef(null);

  async function handleRegenerate() {
    const ok = await confirm({
      title: 'Regenerate QR code',
      message: `Regenerate the QR code for ${student.firstName} ${student.lastName}?\n\nTheir previously printed ID card will stop working.`,
      confirmLabel: 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    try {
      await onRegenerate();
      await notify({ title: 'QR code regenerated', message: 'The student QR code was regenerated successfully.' });
    } catch (e) {
      await notify({ title: 'Action failed', message: e.message || 'Unable to regenerate the QR code.' });
    }
  }

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
          <button className="btn" onClick={handleRegenerate}>Regenerate QR</button>
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
