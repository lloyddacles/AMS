import { useEffect, useState } from 'react';
import { api, exportCsv } from '../api.js';

export default function Reports() {
  const [view, setView] = useState('summary');
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const [overview, setOverview] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p className="muted">Attendance summaries and per-event breakdowns.</p>
        </div>
        <div className="head-actions">
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
          </div>
          {!overview ? (
            <div className="muted">Loading…</div>
          ) : (
            <div className="card table-card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student No</th>
                    <th>Name</th>
                    <th>Course</th>
                    <th className="num">Early</th>
                    <th className="num">On-time</th>
                    <th className="num">Late</th>
                    <th className="num">Excused</th>
                    <th className="num">Absent</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.students.length === 0 && (
                    <tr><td colSpan={9} className="muted center">No students found.</td></tr>
                  )}
                  {overview.students.map((s) => (
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
