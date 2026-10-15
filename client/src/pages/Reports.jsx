import { useEffect, useMemo, useState } from 'react';
import { api, exportCsv } from '../api.js';

const SUMMARY_COLUMNS = [
  { key: 'studentNo', label: 'Student No', get: (s) => s.studentNo || '' },
  { key: 'name', label: 'Name', get: (s) => `${s.lastName || ''} ${s.firstName || ''}` },
  { key: 'course', label: 'Course', get: (s) => s.course || '' },
  { key: 'early', label: 'Early', num: true, get: (s) => s.early || 0 },
  { key: 'onTime', label: 'On-time', num: true, get: (s) => s.onTime || 0 },
  { key: 'late', label: 'Late', num: true, get: (s) => s.late || 0 },
  { key: 'excused', label: 'Excused', num: true, get: (s) => s.excused || 0 },
  { key: 'absent', label: 'Absent', num: true, get: (s) => s.absent || 0 },
  { key: 'rate', label: 'Rate', num: true, get: (s) => s.rate || 0 },
];

const PAGE_SIZES = [10, 25, 50, 100];

export default function Reports() {
  const [view, setView] = useState('summary');
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const [overview, setOverview] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .getReportOverview({ search, course })
        .then(setOverview)
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search, course]);

  useEffect(() => {
    if (view === 'matrix' && !matrix) {
      api.getReportMatrix().then(setMatrix).catch((e) => setError(e.message));
    }
  }, [view, matrix]);

  const courses = overview ? [...new Set(overview.students.map((s) => s.course).filter(Boolean))].sort() : [];

  const sortedStudents = useMemo(() => {
    if (!overview) return [];
    const col = SUMMARY_COLUMNS.find((c) => c.key === sort.key) || SUMMARY_COLUMNS[1];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...overview.students].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      if (col.num) return (av - bv) * dir;
      return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * dir;
    });
  }, [overview, sort]);

  const total = sortedStudents.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => sortedStudents.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedStudents, currentPage, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [search, course, sort, pageSize, view]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  async function exportPdf() {
    if (!overview) return;
    try {
      const { exportSummaryPdf } = await import('../pdf.js');
      exportSummaryPdf(sortedStudents, overview.totalEvents);
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p className="muted">Attendance summaries and per-event breakdowns.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={exportPdf} disabled={!overview}>Export PDF</button>
          <button className="btn" onClick={() => exportCsv('students')}>Export Summary CSV</button>
          <button className="btn" onClick={() => exportCsv('matrix')}>Export Matrix CSV</button>
        </div>
      </div>

      <div className="tabs">
        <button className={view === 'summary' ? 'active' : ''} onClick={() => setView('summary')}>Student Summary</button>
        <button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>Event Matrix</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {view === 'summary' && (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">All courses</option>
              {courses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="toolbar-right">
              <label className="page-size">
                Rows
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>
          {!overview ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
            <div className="card table-card">
              <table className="table">
                <thead>
                  <tr>
                    {SUMMARY_COLUMNS.map((c) => (
                      <th key={c.key} className={c.num ? 'num' : ''}>
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
                  </tr>
                </thead>
                <tbody>
                  {total === 0 && (
                    <tr><td colSpan={9} className="muted center">No students found.</td></tr>
                  )}
                  {pageRows.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.studentNo}</td>
                      <td className="strong">{s.lastName}, {s.firstName}</td>
                      <td>{s.course || '—'}</td>
                      <td className="num">{s.early}</td>
                      <td className="num">{s.onTime}</td>
                      <td className="num">{s.late}</td>
                      <td className="num">{s.excused}</td>
                      <td className="num">{s.absent}</td>
                      <td>
                        <div className="rate-wrap">
                          <div className="rate-bar"><span style={{ width: `${s.rate}%` }} /></div>
                          <span className="rate-label">{s.rate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted small" style={{ padding: '0.75rem 1rem' }}>
                {overview.totalEvents} event{overview.totalEvents === 1 ? '' : 's'} total.
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
            </>
          )}
        </>
      )}

      {view === 'matrix' && (
        <>
          {!matrix ? (
            <div className="muted">Loading…</div>
          ) : (
            <div className="card table-card scroll-x">
              <table className="table matrix">
                <thead>
                  <tr>
                    <th className="sticky-col">Student</th>
                    {matrix.events.map((e) => (
                      <th key={e.id} className="rot">{e.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.students.map((s) => (
                    <tr key={s.id}>
                      <td className="sticky-col strong">{s.lastName}, {s.firstName}</td>
                      {matrix.events.map((e) => {
                        const status = matrix.records[`${e.id}:${s.id}`];
                        return (
                          <td key={e.id} className="cell-mark">
                            {status ? (
                              <span className={`mark mark-${status}`} title={status}>{status[0].toUpperCase()}</span>
                            ) : (
                              <span className="mark mark-absent" title="absent">A</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
