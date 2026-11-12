import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import { api, exportCsv } from '../api.js';
import { useAuth } from '../auth.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';
import RiskExplainer from '../components/RiskExplainer.jsx';
import Modal from '../components/Modal.jsx';
import { buildReportInsights } from '../utils/reportInsights.js';

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
  { status: 'none', label: 'Not on list', mark: '—' },
];

const MARK_LABEL = Object.fromEntries(MARK_LEGEND.map((m) => [m.status, m.mark]));

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '';
  }
}

function toneClass(tone) {
  if (tone === 'positive') return 'is-positive';
  if (tone === 'warning') return 'is-warning';
  if (tone === 'critical') return 'is-critical';
  return 'is-neutral';
}

function priorityClass(priority) {
  if (priority === 'High') return 'priority-high';
  if (priority === 'Medium') return 'priority-medium';
  return 'priority-low';
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const initialView = params.get('view');
  const [view, setView] = useState(['at-risk', 'matrix', 'trends', 'compliance', 'interventions'].includes(initialView) ? initialView : 'summary');
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
  const [compliance, setCompliance] = useState(null);
  const [riskModel, setRiskModel] = useState(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expandedRisk, setExpandedRisk] = useState(null);
  const [riskCache, setRiskCache] = useState({});
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [visualTrends, setVisualTrends] = useState(null);
  const [visualGranularity, setVisualGranularity] = useState('day');
  const [interventionData, setInterventionData] = useState(null);
  const [interventionModal, setInterventionModal] = useState(null); // { student, form, history, saving, generating, error }
  const chartRefs = {
    status: useRef(null),
    distribution: useRef(null),
    trend: useRef(null),
  };

  // Auto-adjust to current real-time period when no date/term filters are set.
  useEffect(() => {
    if (params.get('from') || params.get('to') || params.get('termId')) return;
    const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    setFrom(iso(start));
    setTo(iso(end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    let alive = true;
    api.getRisk().then((d) => { if (alive) setRiskModel(d); }).catch(() => { if (alive) setRiskModel(null); });
    return () => { alive = false; };
  }, [from, to, termId]);

  // Load overall trend points for visual summaries (all courses, archived + active events).
  useEffect(() => {
    let alive = true;
    setVisualTrends(null);
    api
      .getReportTrends({ granularity: visualGranularity, ...rangeParams })
      .then((d) => { if (alive) setVisualTrends(d); })
      .catch(() => { if (alive) setVisualTrends(null); });
    return () => { alive = false; };
  }, [from, to, termId, visualGranularity]);

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
    if (view !== 'compliance') return undefined;
    const t = setTimeout(() => {
      api
        .getReportCompliance({ search, course, ...rangeParams })
        .then(setCompliance)
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
    if (view !== 'interventions') return undefined;
    const t = setTimeout(() => {
      api
        .getInterventionFlags({ search, course })
        .then(setInterventionData)
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [view, search, course]);

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
  const perfectCount = overview ? overview.students.filter((s) => Number(s.rate) === 100).length : 0;
  const belowEighty = overview ? overview.students.filter((s) => Number(s.rate) < 80).length : 0;
  const avgRate = overview && overview.students.length
    ? Math.round(overview.students.reduce((sum, s) => sum + (Number(s.rate) || 0), 0) / overview.students.length)
    : 0;

  const insights = useMemo(() => buildReportInsights({
    overview,
    trends,
    atRisk,
    compliance,
    riskModel,
    filters: { search, course, from, to, termId },
  }), [overview, trends, atRisk, compliance, riskModel, search, course, from, to, termId]);

  const VIEW_COPY = {
    summary: 'Clear per-student attendance totals, rates, and status details for confident reporting.',
    matrix: 'A per-event grid showing every student’s mark at a glance, including exclusions.',
    trends: 'Track attendance movement over time to spot improvement, decline, and patterns.',
    'at-risk': 'Prioritize students below threshold with explainable risk signals and intervention drivers.',
    compliance: 'See who meets or misses the required attendance minimum and what recovery is needed.',
    interventions: 'Flag excessive absences/tardiness, record proof of interventions, identify possible causes, and generate CARES-ready summaries.',
  };

  const sortedStudents = useMemo(() => {
    if (!overview) return [];
    const col = SUMMARY_COLUMNS.find((c) => c.key === sort.key) || SUMMARY_COLUMNS[1];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...overview.students].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      if (col.num) return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true }) * dir;
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

  async function exportFullReportPdf() {
    if (!overview) return;
    try {
      const [trendsData, atRiskData, complianceData] = await Promise.all([
        trends ? Promise.resolve(trends) : api.getReportTrends({ course, granularity, ...rangeParams }).catch(() => null),
        atRisk ? Promise.resolve(atRisk) : api.getAtRisk({ search, course, ...rangeParams }).catch(() => null),
        compliance ? Promise.resolve(compliance) : api.getReportCompliance({ search, course, ...rangeParams }).catch(() => null),
      ]);
      // Give charts a moment to render if needed (e.g. when switching views)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const [statusImg, distImg, trendImg] = await Promise.all([
        captureChartImage(chartRefs.status),
        captureChartImage(chartRefs.distribution),
        captureChartImage(chartRefs.trend),
      ]);
      const termName = termId ? (terms.find((t) => String(t.id) === String(termId))?.name || '') : '';
      const preparedBy = String(user?.name || '').trim() || '—';
      const viewLabelMap = {
        summary: 'Student Summary',
        matrix: 'Event Matrix',
        trends: 'Trends',
        'at-risk': 'At-Risk',
        compliance: 'Compliance',
      };
      const { exportComprehensiveReportPdf } = await import('../pdf.js');
      exportComprehensiveReportPdf({
        overview,
        insights,
        trends: trendsData,
        atRisk: atRiskData,
        compliance: complianceData,
        filters: { search, course, from, to, termId, termName },
        preparedBy,
        viewLabel: viewLabelMap[view] || 'Reports',
        visuals: { status: statusImg, distribution: distImg, trend: trendImg },
      });
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

  const activeFilters = [
    course ? `Course: ${course}` : null,
    search ? `Search: "${search}"` : null,
    from ? `From: ${from}` : null,
    to ? `To: ${to}` : null,
    termId ? `Term: ${terms.find((t) => String(t.id) === String(termId))?.name || termId}` : null,
  ].filter(Boolean);

  async function openInterventionModal(student) {
    const today = new Date().toISOString().slice(0, 10);
    setInterventionModal({
      student,
      history: null,
      loading: true,
      saving: false,
      generating: false,
      error: '',
      form: {
        interventionDate: today,
        causeCategory: '',
        causeDetails: '',
        actionTaken: '',
        summary: '',
      },
    });
    try {
      const data = await api.getStudentInterventions(student.id);
      setInterventionModal((m) => (m && m.student.id === student.id ? { ...m, history: data, loading: false } : m));
    } catch (e) {
      setInterventionModal((m) => (m && m.student.id === student.id ? { ...m, loading: false, error: e.message } : m));
    }
  }

  async function generateInterventionDraft() {
    if (!interventionModal) return;
    setInterventionModal((m) => ({ ...m, generating: true, error: '' }));
    try {
      const draft = await api.generateInterventionSummary(interventionModal.student.id, interventionModal.form);
      setInterventionModal((m) => (m ? { ...m, generating: false, form: { ...m.form, summary: draft.summary || m.form.summary } } : m));
    } catch (e) {
      setInterventionModal((m) => (m ? { ...m, generating: false, error: e.message } : m));
    }
  }

  async function saveInterventionRecord(e) {
    e.preventDefault();
    if (!interventionModal) return;
    setInterventionModal((m) => ({ ...m, saving: true, error: '' }));
    try {
      await api.createIntervention({
        studentId: interventionModal.student.id,
        interventionDate: interventionModal.form.interventionDate,
        causeCategory: interventionModal.form.causeCategory,
        causeDetails: interventionModal.form.causeDetails,
        actionTaken: interventionModal.form.actionTaken,
      });
      const [history, refreshed] = await Promise.all([
        api.getStudentInterventions(interventionModal.student.id),
        api.getInterventionFlags({ search, course }).catch(() => null),
      ]);
      if (refreshed) setInterventionData(refreshed);
      setInterventionModal((m) => (m ? {
        ...m,
        saving: false,
        history,
        form: { ...m.form, actionTaken: '', causeDetails: '', summary: '' },
      } : m));
    } catch (err) {
      setInterventionModal((m) => (m ? { ...m, saving: false, error: err.message } : m));
    }
  }

  const statusChartData = useMemo(() => {
    if (!overview) return [];
    const totals = { Early: 0, 'On-time': 0, Late: 0, Excused: 0, Absent: 0 };
    for (const s of overview.students || []) {
      totals.Early += Number(s.early) || 0;
      totals['On-time'] += Number(s.onTime) || 0;
      totals.Late += Number(s.late) || 0;
      totals.Excused += Number(s.excused) || 0;
      totals.Absent += Number(s.absent) || 0;
    }
    return Object.entries(totals)
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0);
  }, [overview]);

  const rateDistributionData = useMemo(() => {
    if (!overview) return [];
    const buckets = [
      { name: '0-59%', min: 0, max: 59, count: 0 },
      { name: '60-74%', min: 60, max: 74, count: 0 },
      { name: '75-89%', min: 75, max: 89, count: 0 },
      { name: '90-99%', min: 90, max: 99, count: 0 },
      { name: '100%', min: 100, max: 100, count: 0 },
    ];
    for (const s of overview.students || []) {
      if (Number(s.expected || 0) <= 0) continue;
      const r = Number(s.rate) || 0;
      const b = buckets.find((x) => r >= x.min && r <= x.max);
      if (b) b.count += 1;
    }
    return buckets;
  }, [overview]);

  const trendVisualData = useMemo(() => {
    // Prefer the overall total trend (archived + active, all courses) for the visual summary.
    const src = (visualGranularity && visualTrends) ? visualTrends : (visualTrends || trends);
    const points = src?.points || [];
    const limit = visualGranularity === 'day' ? 31 : visualGranularity === 'week' ? 16 : 12;
    return points.slice(-limit);
  }, [trends, visualTrends, visualGranularity]);

  const STATUS_COLORS = {
    Early: '#06b6d4',
    'On-time': '#22c55e',
    Late: '#f59e0b',
    Excused: '#8b5cf6',
    Absent: '#ef4444',
  };
  const DIST_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#16a34a'];

  async function captureChartImage(container) {
    const node = container?.current || container;
    if (!node) return null;
    const svg = node.querySelector('svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width || svg.clientWidth || 600));
    const height = Math.max(1, Math.ceil(rect.height || svg.clientHeight || 260));
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    // Inline computed styles for reliable rasterization
    const srcEls = svg.querySelectorAll('*');
    const cloneEls = clone.querySelectorAll('*');
    srcEls.forEach((el, i) => {
      const c = cloneEls[i];
      if (!c) return;
      const cs = window.getComputedStyle(el);
      const props = ['fill', 'stroke', 'stroke-width', 'font-size', 'font-family', 'font-weight', 'opacity', 'text-anchor', 'dominant-baseline'];
      let style = c.getAttribute('style') || '';
      for (const p of props) {
        const v = cs.getPropertyValue(p);
        if (v) style += `${p}:${v};`;
      }
      c.setAttribute('style', style);
    });
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = svgUrl;
    }).catch(() => null);
    if (!img) return null;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  }

  return (
    <div className="page reports-page">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        subtitle={VIEW_COPY[view] || VIEW_COPY.summary}
        actions={
          <>
            <button className="btn btn-primary" onClick={exportFullReportPdf} disabled={!overview} title="Export complete report with summary, AI insights, and attendance details for submission">
              Export Full Report (PDF)
            </button>
            {view === 'at-risk' ? (
              <>
                <button className="btn" onClick={exportAtRiskPdf} disabled={!atRisk}>At-Risk PDF</button>
                <button className="btn" onClick={() => exportCsv('at-risk', null, { search, course, ...rangeParams })}>Export CSV</button>
              </>
            ) : view === 'trends' ? (
              <button className="btn" onClick={exportTrendsCsv} disabled={!trends}>Export CSV</button>
            ) : view === 'compliance' ? (
              <button className="btn" onClick={() => exportCsv('compliance', null, { search, course, ...rangeParams })} disabled={!compliance}>Export CSV</button>
            ) : (
              <>
                <button className="btn" onClick={exportPdf} disabled={!overview || view !== 'summary'}>Summary PDF</button>
                <button className="btn" onClick={() => exportCsv('students', null, rangeParams)}>Summary CSV</button>
                <button className="btn" onClick={() => exportCsv('matrix', null, rangeParams)}>Matrix CSV</button>
              </>
            )}
          </>
        }
      />

      <div className="tabs">
        <button className={view === 'summary' ? 'active' : ''} onClick={() => setView('summary')}>Student Summary</button>
        <button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>Event Matrix</button>
        <button className={view === 'trends' ? 'active' : ''} onClick={() => setView('trends')}>Trends</button>
        <button className={view === 'at-risk' ? 'active' : ''} onClick={() => setView('at-risk')}>At-Risk</button>
        <button className={view === 'compliance' ? 'active' : ''} onClick={() => setView('compliance')}>Compliance</button>
        <button className={view === 'interventions' ? 'active' : ''} onClick={() => setView('interventions')}>Interventions</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="toolbar report-filters filter-bar reports-filter-bar">
        {(view === 'summary' || view === 'at-risk' || view === 'compliance' || view === 'interventions') && (
          <>
            <input className="search" placeholder="Search students, numbers, courses…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        <div className="toolbar-right reports-quick-ranges">
          <button type="button" className="btn btn-sm" onClick={() => quickRange('all')}>All time</button>
          <button type="button" className="btn btn-sm" onClick={() => quickRange('30')}>Last 30d</button>
          <button type="button" className="btn btn-sm" onClick={() => quickRange('month')}>This month</button>
          <button type="button" className="btn btn-sm" onClick={() => quickRange('year')}>This year</button>
          {(from || to || termId || search || course) && (
            <button type="button" className="btn btn-sm" onClick={() => { setFrom(''); setTo(''); setTermId(''); setSearch(''); setCourse(''); }}>Clear</button>
          )}
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="reports-active-filters">
          <span className="muted small">Active filters:</span>
          {activeFilters.map((f) => <span key={f} className="reports-filter-chip">{f}</span>)}
        </div>
      )}

      <section className="card ai-insights-card">
        <div className="ai-insights-head">
          <div className="ai-insights-title-wrap">
            <div className="ai-badge">AI Insights</div>
            <div>
              <h3 style={{ margin: 0 }}>Attendance intelligence for teacher decisions</h3>
              <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
                Evidence-based insights generated from report data, trends, risk signals, and compliance context.
              </p>
            </div>
          </div>
          <div className="ai-insights-meta">
            <span className={`ai-confidence ai-confidence-${insights.confidence.level.toLowerCase()}`}>Confidence: {insights.confidence.level}</span>
            <span className="muted small">Updated {formatDateTime(insights.generatedAt)}</span>
            <button className="btn btn-sm" type="button" onClick={() => setInsightsOpen((v) => !v)}>{insightsOpen ? 'Hide' : 'Show'}</button>
          </div>
        </div>

        <div className="ai-insights-summary">
          <div className="ai-headline">{insights.headline}</div>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>{insights.summary}</p>
          <div className="ai-coverage">
            <span>Coverage: {insights.metrics.events} events · {insights.metrics.students} students · avg {insights.metrics.avgRate}%</span>
            <span>Data confidence score: {insights.confidence.score}/100</span>
          </div>
          {insights.confidence.reasons?.length > 0 && (
            <ul className="ai-reasons">
              {insights.confidence.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>

        {overview && (
          <div className="ai-visuals">
            <div className="ai-visuals-head">
              <h4 style={{ margin: 0 }}>Visual overview</h4>
              <span className="muted small">Charts for quick identification (included in Full Report PDF)</span>
            </div>
            <div className="ai-visuals-grid">
              <div className="ai-visual-card" ref={chartRefs.status}>
                <div className="ai-visual-title">Attendance status breakdown</div>
                {statusChartData.length === 0 ? (
                  <div className="muted small">No attendance records in range.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label>
                        {statusChartData.map((entry) => (
                          <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="ai-visual-card" ref={chartRefs.distribution}>
                <div className="ai-visual-title">Student attendance rate distribution</div>
                {rateDistributionData.every((d) => d.count === 0) ? (
                  <div className="muted small">No students with expected attendance in range.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={rateDistributionData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]}>
                        {rateDistributionData.map((_, i) => (
                          <Cell key={i} fill={DIST_COLORS[i] || '#3b82f6'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="ai-visual-card ai-visual-card-wide" ref={chartRefs.trend}>
                <div className="ai-visual-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                  <div className="ai-visual-title" style={{ marginBottom: 0 }}>Attendance rate trend ({visualGranularity === 'day' ? 'daily' : visualGranularity === 'week' ? 'weekly' : 'monthly'} total)</div>
                  <div className="seg seg-sm" role="group" aria-label="Trend granularity">
                    {[
                      ['day', 'Daily'],
                      ['week', 'Weekly'],
                      ['month', 'Monthly'],
                    ].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`seg-btn ${visualGranularity === val ? 'active' : ''}`}
                        onClick={() => setVisualGranularity(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="muted small" style={{ margin: '0 0 0.5rem' }}>
                  This graph shows if more or fewer students came {visualGranularity === 'day' ? 'each day' : visualGranularity === 'week' ? 'each week' : 'each month'}, using all events in the selected range (including archived and active). If the line goes up, attendance is getting better. If it goes down, fewer students are coming. It automatically follows the current date range.
                </p>
                {trendVisualData.length === 0 ? (
                  <div className="muted small" style={{ padding: '0.5rem 0' }}>
                    No trend data yet for the dates you picked. Try a different date range or term to see the line.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={trendVisualData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rateFillInsights" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip formatter={(value, name) => [name === 'rate' ? `${value}%` : value, name === 'rate' ? 'Rate' : name]} />
                      <Area type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} fill="url(#rateFillInsights)" name="Rate" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        )}

        {insightsOpen && (
          <div className="ai-insights-grid">
            <div className="ai-panel">
              <h4>Key findings</h4>
              <div className="ai-finding-list">
                {insights.findings.map((f, i) => (
                  <div key={i} className={`ai-finding ${toneClass(f.tone)}`}>
                    <div className="ai-finding-title">{f.title}</div>
                    <div className="ai-finding-detail">{f.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-panel">
              <h4>Recommended decisions & actions</h4>
              <div className="ai-action-list">
                {insights.actions.map((a, i) => (
                  <div key={i} className="ai-action">
                    <div className="ai-action-top">
                      <span className={`ai-priority ${priorityClass(a.priority)}`}>{a.priority} priority</span>
                      <strong>{a.title}</strong>
                    </div>
                    <p>{a.detail}</p>
                    <p className="muted small"><strong>Why:</strong> {a.why}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-panel">
              <h4>Priority students to review</h4>
              {insights.priorityStudents.length === 0 ? (
                <p className="muted">No priority risk cases identified from current data.</p>
              ) : (
                <div className="ai-priority-list">
                  {insights.priorityStudents.map((s) => (
                    <div key={s.id} className="ai-priority-student">
                      <div className="ai-priority-student-main">
                        <strong>{s.name}</strong>
                        <span className="muted small">{s.studentNo}{s.course ? ` · ${s.course}` : ''}</span>
                      </div>
                      <div className="ai-priority-student-metrics">
                        <span className="pill pill-red">{s.rate}% rate</span>
                        {typeof s.risk === 'number' && <span className={`risk-pill risk-${s.riskLevel || 'moderate'}`}>{s.risk}% risk</span>}
                        <span className="muted small">Absent: {s.absent} · Late: {s.late}</span>
                      </div>
                      {s.drivers?.length > 0 && <div className="muted small">Drivers: {s.drivers.join(', ')}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ai-panel">
              <h4>Group & pattern highlights</h4>
              {insights.groups.length > 1 ? (
                <div className="ai-group-list">
                  {insights.groups.map((g) => (
                    <div key={g.course} className="ai-group-row">
                      <div>
                        <strong>{g.course}</strong>
                        <div className="muted small">{g.count} students · {g.below80} below 80%</div>
                      </div>
                      <div className="ai-group-rate">
                        <div className="rate-bar"><span style={{ width: `${Math.max(0, Math.min(100, g.avgRate))}%` }} /></div>
                        <span className="rate-label">{g.avgRate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Not enough course-group variation in the current data for group comparison.</p>
              )}
              {insights.notable?.lateHeavy?.length > 0 && (
                <div className="ai-note-box">
                  <strong>Frequent lateness:</strong> {insights.notable.lateHeavy.map((s) => `${s.lastName}, ${s.firstName} (${s.late})`).join('; ')}
                </div>
              )}
              {insights.notable?.highAbsence?.length > 0 && (
                <div className="ai-note-box">
                  <strong>Most absences:</strong> {insights.notable.highAbsence.map((s) => `${s.lastName}, ${s.firstName} (${s.absent})`).join('; ')}
                </div>
              )}
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                AI insights are generated from available attendance/risk data to support decisions; verify context before taking formal action.
              </p>
            </div>
          </div>
        )}
      </section>

      {view === 'summary' && (
        <>
          <div className="toolbar">
            <div className="muted small">Showing {overview ? overview.students.length : 0} student{overview && overview.students.length === 1 ? '' : 's'} in the selected range</div>
            <div className="toolbar-right">
              <label className="page-size">
                Rows
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>
          {overview && (
            <div className="stat-grid">
              <StatCard icon="users" accent="blue" label="Students" value={overview.students.length} hint="Matching filters" />
              <StatCard icon="calendar" accent="purple" label="Events" value={overview.totalEvents} hint="In selected range" />
              <StatCard icon="chart" accent="green" label="Average rate" value={`${avgRate}%`} hint="Across listed students" />
              <StatCard icon="alert" accent="amber" label="Need attention" value={belowEighty} hint={`${perfectCount} perfect attendance`} />
            </div>
          )}
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
                      <tr><td colSpan={9} className="muted center">No students found for the selected filters.</td></tr>
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
                            <div className={`rate-bar ${Number(s.rate) < 75 ? 'danger' : ''}`}><span style={{ width: `${s.rate}%` }} /></div>
                            <span className="rate-label">{s.rate}%</span>
                          </div>
                          <div className="muted small">Attended {s.attended}/{s.expected} expected</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ padding: '0.75rem 1rem' }}>
                  {overview.totalEvents} event{overview.totalEvents === 1 ? '' : 's'} total · rates are based on each student’s expected attendance in this range.
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
                <span className="muted small" style={{ marginLeft: 'auto' }}>{matrix.events.length} events · {matrix.students.length} students</span>
              </div>
              <div className="scroll-x">
                <table className="table matrix">
                  <thead>
                    <tr>
                      <th className="sticky-col">Student</th>
                      {matrix.events.map((e) => (
                        <th key={e.id} className="rot" title={`${e.name}${e.eventDate ? ` (${e.eventDate})` : ''}`}>{e.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.students.length === 0 && (
                      <tr><td colSpan={Math.max(1, matrix.events.length + 1)} className="muted center">No students found.</td></tr>
                    )}
                    {matrix.students.map((s) => (
                      <tr key={s.id}>
                        <td className="sticky-col strong">{s.lastName}, {s.firstName} <span className="muted small">({s.studentNo})</span></td>
                        {matrix.events.map((e) => {
                          const key = `${e.id}:${s.id}`;
                          const offList = matrix.excluded?.[key];
                          const status = matrix.records[key];
                          return (
                            <td key={e.id} className="cell-mark">
                              {offList ? (
                                <span className="mark mark-none" title="Not on the attendee list for this event">—</span>
                              ) : status ? (
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
                <StatCard icon="calendar" label="Events in range" value={trends.summary.events} accent="purple" />
                <StatCard icon="check" label="Present" value={trends.summary.present} accent="green" />
                <StatCard icon="alert" label="Absent" value={trends.summary.absent} accent="amber" />
                <StatCard icon="chart" label="Attendance rate" value={`${trends.summary.rate}%`} accent="blue" />
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Attendance rate over time</h3>
                  <span className="muted small">
                    {granularity === 'event' ? 'Per event' : `By ${granularity}`} · {trends.totalStudents} student{trends.totalStudents === 1 ? '' : 's'} in scope · trend {insights.metrics.trend.label.toLowerCase()}
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
                            <div className={`rate-bar ${p.rate < 75 ? 'danger' : ''}`}><span style={{ width: `${p.rate}%` }} /></div>
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
            <div className="muted small">Students below the attendance threshold are prioritized for intervention.</div>
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
                        No students below {atRisk.threshold}% attendance for the selected filters.
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
                {' '}Risk is an explainable score with transparent drivers — open a score to review factors and decide next steps.
              </div>
            </div>
          )}
        </>
      )}

      {view === 'compliance' && (
        <>
          {!compliance ? (
            <div className="card"><Spinner label="Loading compliance…" size="lg" variant="panel" /></div>
          ) : (
            <>
              <div className="stat-grid">
                <StatCard icon="shield" label={compliance.termName ? `Minimum — ${compliance.termName}` : 'Minimum'} value={`${compliance.minimum}%`} accent="purple" />
                <StatCard icon="alert" label="Non-compliant" value={compliance.below} accent="amber" />
                <StatCard icon="users" label="Total students" value={compliance.totalStudents} accent="blue" />
                <StatCard icon="calendar" label="Events in range" value={compliance.totalEvents} accent="green" />
              </div>
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
                      <th className="num">Needed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!compliance.eligible && (
                      <tr><td colSpan={9} className="muted center">No events in the selected range{termId ? ' for this term' : ''}.</td></tr>
                    )}
                    {compliance.eligible && compliance.students.length === 0 && (
                      <tr><td colSpan={9} className="muted center">All students meet or exceed {compliance.minimum}% attendance.</td></tr>
                    )}
                    {compliance.students.map((s) => (
                      <tr key={s.id}>
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
                        <td className="num"><strong>{s.needed}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ padding: '0.75rem 1rem' }}>
                  {compliance.below} below {compliance.minimum}% · {compliance.compliantCount} compliant · based on {compliance.totalEvents} event{compliance.totalEvents === 1 ? '' : 's'} total. “Needed” shows attendances required to reach the minimum.
                </div>
              </div>
            </>
          )}
        </>
      )}

      {view === 'interventions' && (
        <>
          {!interventionData ? (
            <div className="card"><Spinner label="Loading intervention flags…" size="lg" variant="panel" /></div>
          ) : (
            <>
              <div className="stat-grid">
                <StatCard icon="alert" accent="amber" label="Flagged for intervention" value={interventionData.students.length} hint="Excessive absences/tardiness or at-risk" />
                <StatCard icon="users" accent="blue" label="High priority" value={interventionData.students.filter((s) => s.flags?.priority === 'High').length} hint="3 consecutive or high accumulation" />
                <StatCard icon="check" accent="green" label="With recorded intervention" value={interventionData.students.filter((s) => s.latestIntervention).length} hint="Proof/action documented" />
                <StatCard icon="shield" accent="purple" label="Needs documentation" value={interventionData.students.filter((s) => !s.latestIntervention).length} hint="No intervention record yet" />
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>Intervention flagging rules</h3>
                </div>
                <p className="muted small" style={{ marginTop: 0 }}>
                  Students are flagged for intervention when there are <strong>3 consecutive absences</strong>, <strong>3 consecutive lates</strong>, or <strong>accumulated excessive absences/tardiness</strong> (e.g. many total absences/lates).
                  Record what you did, identify possible causes (medical, family, or other issues), and generate an AI-assisted summary for easier CARES reporting.
                </p>
              </div>

              <div className="card table-card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Course</th>
                      <th className="num">Rate</th>
                      <th className="num">Absent</th>
                      <th className="num">Late</th>
                      <th>Flag triggers</th>
                      <th>Last intervention</th>
                      <th className="right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interventionData.students.length === 0 && (
                      <tr><td colSpan={8} className="muted center">No students currently flagged for intervention based on the rules.</td></tr>
                    )}
                    {interventionData.students.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="strong">{s.name}</div>
                          <div className="muted small mono">{s.studentNo}</div>
                        </td>
                        <td>{s.course || '—'}</td>
                        <td className="num">
                          <div className="rate-wrap">
                            <div className={`rate-bar ${Number(s.rate) < 75 ? 'danger' : ''}`}><span style={{ width: `${s.rate}%` }} /></div>
                            <span className="rate-label">{s.rate}%</span>
                          </div>
                        </td>
                        <td className="num">{s.absent}{s.streak >= 3 ? <div className="muted small">Streak: {s.streak}</div> : null}</td>
                        <td className="num">{s.late}{s.lateStreak >= 3 ? <div className="muted small">Streak: {s.lateStreak}</div> : null}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {(s.flags?.triggers || []).map((t, i) => (
                              <span key={i} className={`pill ${t.priority === 'High' ? 'pill-red' : 'pill-amber'}`}>{t.label}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {s.latestIntervention ? (
                            <div>
                              <div className="small strong">{s.latestIntervention.interventionDate || 'Recorded'}</div>
                              <div className="muted small">{s.latestIntervention.causeCategory || 'Cause not set'}</div>
                            </div>
                          ) : (
                            <span className="pill pill-gray">None yet</span>
                          )}
                        </td>
                        <td className="right actions">
                          <button className="btn btn-sm btn-primary" onClick={() => openInterventionModal(s)}>Record / View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ padding: '0.75rem 1rem' }}>
                  Flagged students: {interventionData.students.length}. Interventions serve as proof of follow-up and can support CARES reporting.
                </div>
              </div>
            </>
          )}
        </>
      )}

      {interventionModal && (
        <Modal
          wide
          title={`Intervention — ${interventionModal.student.name}`}
          onClose={() => setInterventionModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setInterventionModal(null)}>Close</button>
              <button className="btn btn-primary" onClick={saveInterventionRecord} disabled={interventionModal.saving}>
                {interventionModal.saving ? 'Saving…' : 'Save intervention (proof)'}
              </button>
            </>
          }
        >
          <div className="form event-form">
            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Why flagged</h4>
                <p className="muted small">System-detected attendance concerns for this student.</p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {(interventionModal.student.flags?.triggers || []).map((t, i) => (
                  <span key={i} className={`pill ${t.priority === 'High' ? 'pill-red' : 'pill-amber'}`}>{t.label}</span>
                ))}
                {!interventionModal.student.flags?.triggers?.length && <span className="muted small">No specific triggers listed.</span>}
              </div>
              <div className="muted small" style={{ marginTop: '0.5rem' }}>
                Absences: {interventionModal.student.absent} (streak {interventionModal.student.streak || 0}) · Lates: {interventionModal.student.late} (streak {interventionModal.student.lateStreak || 0}) · Rate: {interventionModal.student.rate}% · Risk: {interventionModal.student.risk}%
              </div>
            </section>

            <form className="event-form-section" onSubmit={saveInterventionRecord}>
              <div className="event-form-section-head">
                <h4>Record intervention (proof)</h4>
                <p className="muted small">Document the action taken and possible cause to help with follow-up and CARES reporting.</p>
              </div>
              <div className="form grid-form">
                <label>
                  <span>Intervention date</span>
                  <input
                    type="date"
                    value={interventionModal.form.interventionDate}
                    onChange={(e) => setInterventionModal((m) => ({ ...m, form: { ...m.form, interventionDate: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>Possible cause / issue</span>
                  <select
                    value={interventionModal.form.causeCategory}
                    onChange={(e) => setInterventionModal((m) => ({ ...m, form: { ...m.form, causeCategory: e.target.value } }))}
                  >
                    <option value="">Select a cause (helps understand context)</option>
                    {(interventionData?.causeCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="span-2">
                  <span>Cause details (optional)</span>
                  <textarea
                    rows={2}
                    value={interventionModal.form.causeDetails}
                    onChange={(e) => setInterventionModal((m) => ({ ...m, form: { ...m.form, causeDetails: e.target.value } }))}
                    placeholder="e.g. Medical certificate provided, family emergency, transportation issues, etc."
                  />
                </label>
                <label className="span-2">
                  <span>Intervention / action taken (proof) <span className="req">*</span></span>
                  <textarea
                    rows={3}
                    value={interventionModal.form.actionTaken}
                    onChange={(e) => setInterventionModal((m) => ({ ...m, form: { ...m.form, actionTaken: e.target.value } }))}
                    placeholder="What did you do? (e.g. called guardian, met with student, referred to CARES/counselor, agreed on attendance plan)"
                    required
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-sm" onClick={generateInterventionDraft} disabled={interventionModal.generating}>
                  {interventionModal.generating ? 'Generating…' : 'Generate AI summary'}
                </button>
                <span className="muted small" style={{ alignSelf: 'center' }}>Auto-generates a CARES-ready summary from flags, cause, and your action.</span>
              </div>
              {interventionModal.form.summary && (
                <div className="card" style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#f8fafc' }}>
                  <div className="strong small" style={{ marginBottom: '0.25rem' }}>Generated summary preview</div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{interventionModal.form.summary}</div>
                </div>
              )}
              {interventionModal.error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{interventionModal.error}</div>}
            </form>

            <section className="event-form-section">
              <div className="event-form-section-head">
                <h4>Intervention history (proof records)</h4>
                <p className="muted small">Previously recorded actions for this student.</p>
              </div>
              {interventionModal.loading ? (
                <div className="muted small">Loading history…</div>
              ) : !(interventionModal.history?.interventions || []).length ? (
                <div className="muted small">No interventions recorded yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  {interventionModal.history.interventions.map((i) => (
                    <div key={i.id} className="card" style={{ padding: '0.7rem 0.85rem', boxShadow: 'none', border: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div className="strong small">{i.interventionDate} · {i.causeCategory || 'Cause not specified'}</div>
                        <div className="muted small">{i.createdByName || 'Staff'}</div>
                      </div>
                      <div className="small" style={{ marginTop: '0.25rem' }}><strong>Action taken:</strong> {i.actionTaken}</div>
                      {i.causeDetails ? <div className="muted small" style={{ marginTop: '0.2rem' }}><strong>Cause details:</strong> {i.causeDetails}</div> : null}
                      {i.summary ? <details style={{ marginTop: '0.35rem' }}><summary className="small linklike" style={{ cursor: 'pointer' }}>View AI-generated summary</summary><div className="small muted" style={{ marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>{i.summary}</div></details> : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}
