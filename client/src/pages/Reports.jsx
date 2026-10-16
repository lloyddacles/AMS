import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import { api, exportCsv } from '../api.js';
import { useAuth } from '../auth.jsx';
import Spinner from '../components/Spinner.jsx';
import RiskExplainer from '../components/RiskExplainer.jsx';

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

const MARK_LEGEND = [
  { status: 'early', label: 'Early', mark: 'E' },
  { status: 'on-time', label: 'On-time', mark: 'O' },
  { status: 'present', label: 'Present', mark: 'P' },
  { status: 'late', label: 'Late', mark: 'L' },
  { status: 'excused', label: 'Excused', mark: 'X' },
  { status: 'absent', label: 'Absent', mark: 'A' },
];
const MARK_LABEL = Object.fromEntries(MARK_LEGEND.map((m) => [m.status, m.mark]));

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const initialView = params.get('view');
  const [view, setView] = useState(['at-risk', 'matrix', 'trends'].includes(initialView) ? initialView : 'summary');
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  const [termId, setTermId] = useState(params.get('termId') || '');
  const [terms, setTerms] = useState([]);
  const [granularity, setGranularity] = useState('day');
  const [overview, setOverview] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [atRisk, setAtRisk] = useState(null);
  const [trends, setTrends] = useState(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expandedRisk, setExpandedRisk] = useState(null);
  const [riskCache, setRiskCache] = useState({});

  const rangeParams = { from, to, termId: termId || '' };

  useEffect(() => {
    api.getTerms().then(setTerms).catch(() => setTerms([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .getReportOverview({ search, course, ...rangeParams })
        .then(setOverview)
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search, course, from, to, termId]);

  useEffect(() => {
    if (view !== 'matrix') return undefined;
    let alive = true;
    setMatrix(null);
    api
      .getReportMatrix(rangeParams)
      .then((d) => { if (alive) setMatrix(d); })
      .catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [view, from, to, termId]);

  useEffect(() => {
    if (view !== 'at-risk') return undefined;
    const t = setTimeout(() => {
      api
        .getAtRisk({ search, course, ...rangeParams })
        .then((d) => {
          setAtRisk(d);
          setThresholdInput(String(d.threshold));
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [view, search, course, from, to, termId]);

  useEffect(() => {
    if (view !== 'trends') return undefined;
    let alive = true;
    setTrends(null);
    api
      .getReportTrends({ course, granularity, ...rangeParams })
      .then((d) => { if (alive) setTrends(d); })
      .catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [view, course, granularity, from, to, termId]);

  useEffect(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'summary') next.delete('view');
      else next.set('view', view);
      if (from) next.set('from', from); else next.delete('from');
      if (to) next.set('to', to); else next.delete('to');
      if (termId) next.set('termId', termId); else next.delete('termId');
      return next;
    }, { replace: true });
  }, [view, from, to, termId, setParams]);

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
  }, [search, course, from, to, termId, sort, pageSize, view]);

  function quickRange(kind) {
    const iso = (d) => d.toISOString().slice(0, 10);
    if (kind === 'all') { setFrom(''); setTo(''); return; }
    const today = new Date();
    if (kind === '30') {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 29);
      setFrom(iso(start));
      setTo(iso(today));
    } else if (kind === 'month') {
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth();
      setFrom(iso(new Date(Date.UTC(y, m, 1))));
      setTo(iso(new Date(Date.UTC(y, m + 1, 0))));
    } else if (kind === 'year') {
      const y = today.getUTCFullYear();
      setFrom(`${y}-01-01`);
      setTo(`${y}-12-31`);
    }
  }

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

  async function exportAtRiskPdf() {
    if (!atRisk) return;
    try {
      const { exportAtRiskPdf: render } = await import('../pdf.js');
      render(atRisk.students, atRisk.threshold, atRisk.totalEvents);
    } catch (e) {
      alert(e.message);
    }
  }

  async function saveThreshold(e) {
    e.preventDefault();
    const value = Number(thresholdInput);
    if (!Number.isFinite(value)) return;
    try {
      await api.updateSettings({ atRiskThreshold: value });
      const d = await api.getAtRisk({ search, course, ...rangeParams });
      setAtRisk(d);
      setThresholdInput(String(d.threshold));
    } catch (err) {
      alert(err.message);
    }
  }

  function exportTrendsCsv() {
    if (!trends) return;
    const header = ['Period', 'Events', 'Present', 'Early', 'On-time', 'Late', 'Excused', 'Absent', 'Rate %'];
    const lines = [header.join(',')];
    for (const p of trends.points) {
      lines.push([p.label, p.events, p.present, p.early, p.onTime, p.late, p.excused, p.absent, p.rate].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-trend-${granularity}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggleRisk(student) {
    setExpandedRisk((cur) => (cur === student.id ? null : student.id));
    if (!riskCache[student.id]) {
      api
        .getStudentRisk(student.id)
        .then((d) => setRiskCache((c) => ({ ...c, [student.id]: d })))
        .catch(() => setRiskCache((c) => ({ ...c, [student.id]: { error: true } })));
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
          {view === 'at-risk' ? (
            <>
              <button className="btn" onClick={exportAtRiskPdf} disabled={!atRisk}>Export PDF</button>
              <button className="btn" onClick={() => exportCsv('at-risk', null, { search, course, ...rangeParams })}>Export CSV</button>
            </>
          ) : view === 'trends' ? (
            <button className="btn" onClick={exportTrendsCsv} disabled={!trends}>Export CSV</button>
          ) : (
            <>
              <button className="btn" onClick={exportPdf} disabled={!overview || view !== 'summary'}>Export PDF</button>
              <button className="btn" onClick={() => exportCsv('students', null, rangeParams)}>Export Summary CSV</button>
              <button className="btn" onClick={() => exportCsv('matrix', null, rangeParams)}>Export Matrix CSV</button>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={view === 'summary' ? 'active' : ''} onClick={() => setView('summary')}>Student Summary</button>
        <button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>Event Matrix</button>
        <button className={view === 'trends' ? 'active' : ''} onClick={() => setView('trends')}>Trends</button>
        <button className={view === 'at-risk' ? 'active' : ''} onClick={() => setView('at-risk')}>At-Risk</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="toolbar report-filters">
        {(view === 'summary' || view === 'at-risk') && (
          <>
            <input className="search" placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">All courses</option>
              {courses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        {view === 'trends' && (
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All courses</option>
            {courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <label className="date-field">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date-field">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select className="term-filter" value={termId} onChange={(e) => setTermId(e.target.value)}>
          <option value="">All terms</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{Number(t.isCurrent) === 1 ? ' (current)' : ''}</option>)}
        </select>
        {view === 'trends' && (
          <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="event">Per event</option>
          </select>
        )}
        <div className="toolbar-right">
          <button type="button" className="btn btn-sm" onClick={() => quickRange('all')}>All time</button>
          <button type="button" className="btn btn-sm" onClick={() => quickRange('30')}>Last 30d</button>
          <button type="button" className="btn btn-sm" onClick={() => quickRange('month')}>This month</button>
          <button type="button" className="btn btn-sm" onClick={() => quickRange('year')}>This year</button>
        </div>
        {(from || to || termId) && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => { setFrom(''); setTo(''); setTermId(''); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {view === 'summary' && (
        <>
          <div className="toolbar">
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
            <div className="card"><Spinner label="Loading report…" size="lg" variant="panel" /></div>
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
            <div className="card"><Spinner label="Loading report…" size="lg" variant="panel" /></div>
          ) : (
            <div className="card table-card">
              <div className="cell-legend">
                {MARK_LEGEND.map((m) => (
                  <span className="cell-legend-item" key={m.status}>
                    <span className={`mark mark-${m.status}`}>{m.mark}</span>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="scroll-x">
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
                              <span className={`mark mark-${status}`} title={status}>{MARK_LABEL[status] || status[0].toUpperCase()}</span>
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
            </div>
          )}
        </>
      )}

      {view === 'trends' && (
        <>
          {!trends ? (
            <div className="card"><Spinner label="Loading trends…" size="lg" variant="panel" /></div>
          ) : (
            <>
              <div className="stat-grid">
                <StatCard label="Events in range" value={trends.summary.events} accent="purple" />
                <StatCard label="Present" value={trends.summary.present} accent="green" />
                <StatCard label="Absent" value={trends.summary.absent} accent="amber" />
                <StatCard label="Attendance rate" value={`${trends.summary.rate}%`} accent="blue" />
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Attendance rate over time</h3>
                  <span className="muted small">
                    {granularity === 'event' ? 'Per event' : `By ${granularity}`} · {trends.totalStudents} student{trends.totalStudents === 1 ? '' : 's'} in scope
                  </span>
                </div>
                {trends.points.length === 0 ? (
                  <p className="muted">No events in the selected range{termId ? ' and term' : ''}.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trends.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                      <Tooltip
                        formatter={(value, name) => [
                          name === 'rate' ? `${value}%` : value,
                          name === 'rate' ? 'Rate' : name,
                        ]}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} fill="url(#rateFill)" name="rate" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="card table-card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{granularity === 'event' ? 'Event' : 'Period'}</th>
                      <th className="num">Events</th>
                      <th className="num">Present</th>
                      <th className="num">Early</th>
                      <th className="num">On-time</th>
                      <th className="num">Late</th>
                      <th className="num">Excused</th>
                      <th className="num">Absent</th>
                      <th>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.points.length === 0 && (
                      <tr><td colSpan={9} className="muted center">No data for the selected range.</td></tr>
                    )}
                    {trends.points.map((p) => (
                      <tr key={p.key}>
                        <td className="strong">{p.label}</td>
                        <td className="num">{p.events}</td>
                        <td className="num">{p.present}</td>
                        <td className="num">{p.early}</td>
                        <td className="num">{p.onTime}</td>
                        <td className="num">{p.late}</td>
                        <td className="num">{p.excused}</td>
                        <td className="num">{p.absent}</td>
                        <td>
                          <div className="rate-wrap">
                            <div className="rate-bar"><span style={{ width: `${p.rate}%` }} /></div>
                            <span className="rate-label">{p.rate}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {view === 'at-risk' && (
        <>
          <div className="toolbar">
            <form className="toolbar-right threshold-form" onSubmit={saveThreshold}>
              <label>
                Threshold %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  disabled={user?.role !== 'admin'}
                  title={user?.role !== 'admin' ? 'Admins only' : 'Students below this rate are flagged'}
                />
              </label>
              {user?.role === 'admin' && (
                <button className="btn btn-sm" type="submit" disabled={!atRisk || Number(thresholdInput) === atRisk.threshold}>
                  Save
                </button>
              )}
            </form>
          </div>
          {!atRisk ? (
            <div className="card"><Spinner label="Loading report…" size="lg" variant="panel" /></div>
          ) : (
            <div className="card table-card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student No</th>
                    <th>Name</th>
                    <th>Course</th>
                    <th>Year</th>
                    <th className="num">Attended</th>
                    <th className="num">Absent</th>
                    <th className="num">Excused</th>
                    <th>Rate</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.students.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted center">
                        No students below {atRisk.threshold}% attendance.
                      </td>
                    </tr>
                  )}
                  {atRisk.students.map((s) => (
                    <Fragment key={s.id}>
                      <tr className={typeof s.risk === 'number' ? 'row-clickable' : ''}>
                        <td className="mono">{s.studentNo}</td>
                        <td className="strong">{s.lastName}, {s.firstName}</td>
                        <td>{s.course || '—'}</td>
                        <td>{s.yearLevel || '—'}</td>
                        <td className="num">{s.attended}</td>
                        <td className="num">{s.absent}</td>
                        <td className="num">{s.excused}</td>
                        <td>
                          <div className="rate-wrap">
                            <div className="rate-bar danger"><span style={{ width: `${s.rate}%` }} /></div>
                            <span className="rate-label">{s.rate}%</span>
                          </div>
                        </td>
                        <td>
                          {typeof s.risk === 'number' ? (
                            <button
                              type="button"
                              className={`risk-pill risk-${s.riskLevel} ${expandedRisk === s.id ? 'open' : ''}`}
                              onClick={() => toggleRisk(s)}
                              title="Show what drives this risk score"
                            >
                              {s.risk}%
                              <span className="risk-caret">{expandedRisk === s.id ? '▲' : '▼'}</span>
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                      {expandedRisk === s.id && (
                        <tr className="risk-detail-row">
                          <td colSpan={9}>
                            <RiskExplainer
                              student={s}
                              detail={riskCache[s.id]}
                              context={atRisk.model?.context}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <div className="muted small" style={{ padding: '0.75rem 1rem' }}>
                {atRisk.students.length} at-risk student{atRisk.students.length === 1 ? '' : 's'} · below {atRisk.threshold}% ·
                {' '}based on {atRisk.totalEvents} event{atRisk.totalEvents === 1 ? '' : 's'} total.
                {' '}Risk is an explainable logistic score (exact SHAP) — tap a score to see drivers.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
