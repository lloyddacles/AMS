import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Spinner from '../components/Spinner.jsx';

const STATUS_COLORS = {
  early: '#06b6d4',
  'on-time': '#16a34a',
  present: '#2563eb',
  late: '#f59e0b',
  excused: '#7c3aed',
  absent: '#ef4444',
};

const STATUS_LABELS = {
  early: 'Early',
  'on-time': 'On-time',
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
};

const ICONS = {
  students:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  events: 'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18 M8 14h.01 M12 14h.01 M16 14h.01',
  checkins: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  rate: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let busy = false;
    const load = async ({ silent = false } = {}) => {
      if (busy) return;
      busy = true;
      try {
        const data = await api.getDashboard();
        if (alive) {
          setStats(data);
          setError('');
        }
      } catch (e) {
        if (alive && !silent) setError(e.message);
      } finally {
        busy = false;
      }
    };

    load();
    const interval = setInterval(() => load({ silent: true }), 30000);
    const onFocus = () => load({ silent: true });
    const onVisibility = () => { if (document.visibilityState === 'visible') load({ silent: true }); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!stats) {
    return (
      <div className="card">
        <Spinner label="Loading dashboard…" size="lg" variant="panel" />
      </div>
    );
  }

  const statusData = (stats.statusBreakdown || []).map((s) => ({
    key: s.status,
    name: STATUS_LABELS[s.status] || s.status,
    value: s.count,
  }));
  const statusTotal = statusData.reduce((sum, s) => sum + s.value, 0);
  const rawName = String(user?.name || '').trim();
  const hasSalutation = /^(sir|mr\.?|mrs\.?|ms\.?|dr\.?|prof\.?)\b/i.test(rawName);
  const greetingName = rawName ? (hasSalutation ? rawName : `Sir ${rawName}`) : 'Sir';
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const atRiskCount = Number(stats?.atRisk?.count || 0);
  const threshold = Number(stats?.atRisk?.threshold || 0);

  return (
    <div className="page dashboard-page">
      <section className="dash-hero dashboard-hero dashboard-hero-v2">
        <div className="dash-hero-copy">
          <span className="dash-eyebrow">Attendance Overview</span>
          <h2>{greeting()}, {greetingName}</h2>
          <p className="muted">
            A quick snapshot of attendance.
            {user?.role === 'admin' ? ' Open Reports for detailed insights, trends, and student-level summaries.' : ''}
          </p>
          <div className="dashboard-hero-meta">
            <span className="dashboard-meta-chip">{todayLabel}</span>
            <span className="dashboard-meta-chip">Overall rate: {stats.overallRate}%</span>
            <span className="dashboard-meta-chip">{stats.totalRecords} check-ins recorded</span>
          </div>
        </div>
        <div className="dash-hero-actions dashboard-hero-actions">
          <Link to="/live" className="btn btn-primary">Open Live Scan</Link>
          <Link to="/events" className="btn">Events</Link>
          {user?.role === 'admin' && <Link to="/reports" className="btn">Reports & Details</Link>}
        </div>
      </section>

      <div className="stat-grid dashboard-stat-grid">
        <StatCard icon="students" accent="blue" label="Students" value={stats.totalStudents} hint="Total enrolled" />
        <StatCard icon="events" accent="purple" label="Events" value={stats.totalEvents} hint="Recorded events" />
        <StatCard icon="checkins" accent="green" label="Check-ins" value={stats.totalRecords} hint="Total time-ins" />
        <StatCard icon="rate" accent="amber" label="Overall rate" value={`${stats.overallRate}%`} hint="Average attendance" />
      </div>

      <div className="dash-charts dashboard-charts">
        <section className="card dash-chart-card dashboard-panel">
          <div className="dash-card-head">
            <div>
              <h3>Attendance per Week</h3>
              <p className="muted small">
                {stats.trendMeta?.monthLabel
                  ? `${stats.trendMeta.monthLabel} · Weekly totals for events/classes this month (real-time)`
                  : 'Weekly attendance summary (real-time)'}
              </p>
            </div>
            {user?.role === 'admin' && <Link className="link" to="/reports?view=trends">Detailed trends</Link>}
          </div>
          {stats.trend?.length ? (
            <>
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={stats.trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#2563eb" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={6} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.name || label}
                    formatter={(value, _name, props) => {
                      const events = props?.payload?.events;
                      return [value, Number.isFinite(events) ? `Attended (${events} event${events === 1 ? '' : 's'})` : 'Attended'];
                    }}
                  />
                  <Bar dataKey="attended" fill="url(#dashBarFill)" radius={[8, 8, 0, 0]} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
              <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
                Shows weekly attendance totals for {stats.trendMeta?.monthLabel || 'the current month'}. Weeks with no events/classes show 0.
              </p>
            </>
          ) : (
            <EmptyState label={`No events/classes found for ${stats.trendMeta?.monthLabel || 'this month'} yet.`} />
          )}
        </section>

        <section className="card dash-chart-card dashboard-panel">
          <div className="dash-card-head">
            <div>
              <h3>Status Breakdown</h3>
              <p className="muted small">Overall check-in statuses</p>
            </div>
            <Link className="link" to="/reports">Full reports</Link>
          </div>
          {statusData.length ? (
            <>
              <div className="dash-donut">
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={64} outerRadius={94} paddingAngle={2} stroke="none">
                      {statusData.map((entry) => (
                        <Cell key={entry.key} fill={STATUS_COLORS[entry.key] || '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-center">
                  <strong>{statusTotal}</strong>
                  <span>records</span>
                </div>
              </div>
              <ul className="dash-legend">
                {statusData.map((entry) => {
                  const pct = statusTotal ? Math.round((entry.value / statusTotal) * 100) : 0;
                  return (
                    <li key={entry.key}>
                      <span className="dash-legend-dot" style={{ background: STATUS_COLORS[entry.key] || '#94a3b8' }} />
                      <span className="dash-legend-label">{entry.name}</span>
                      <span className="dash-legend-value">{entry.value}</span>
                      <span className="dash-legend-pct">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyState label="No attendance records yet." />
          )}
        </section>
      </div>

      {user?.role === 'admin' && (
      <section className="card dashboard-panel">
        <div className="dash-card-head">
          <div>
            <h3>Need details?</h3>
            <p className="muted small">Detailed summaries, student lists, trends, risks, and compliance are available in Reports.</p>
          </div>
          <Link className="link" to="/reports">Open Reports</Link>
        </div>
        <div className="stat-grid" style={{ marginTop: '0.25rem' }}>
          <div className="dash-mini-stat">
            <span>At-risk students</span>
            <strong>{atRiskCount}</strong>
            <small>{threshold ? `Below ${threshold}% threshold` : 'Threshold not set'}</small>
            <div style={{ marginTop: '0.5rem' }}><Link className="link" to="/reports?view=at-risk">View details</Link></div>
          </div>
          <div className="dash-mini-stat">
            <span>Attendance trends</span>
            <strong>View</strong>
            <small>Daily, weekly, monthly charts</small>
            <div style={{ marginTop: '0.5rem' }}><Link className="link" to="/reports?view=trends">Open trends</Link></div>
          </div>
          <div className="dash-mini-stat">
            <span>Student summary</span>
            <strong>View</strong>
            <small>Per-student rates and totals</small>
            <div style={{ marginTop: '0.5rem' }}><Link className="link" to="/reports?view=summary">Open summary</Link></div>
          </div>
          <div className="dash-mini-stat">
            <span>Compliance</span>
            <strong>View</strong>
            <small>Minimum attendance tracking</small>
            <div style={{ marginTop: '0.5rem' }}><Link className="link" to="/reports?view=compliance">Open compliance</Link></div>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  boxShadow: '0 12px 28px -16px rgba(15, 23, 42, 0.35)',
  fontSize: 12,
  padding: '8px 10px',
};

function StatCard({ icon, label, value, hint, accent }) {
  return (
    <div className={`dash-stat dash-accent-${accent}`}>
      <div className="dash-stat-head">
        <span className="dash-stat-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={ICONS[icon]} />
          </svg>
        </span>
        <span className="dash-stat-label">{label}</span>
      </div>
      <div className="dash-stat-value">{value}</div>
      <div className="dash-stat-hint">{hint}</div>
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="dash-empty">
      <span className="dash-empty-mark" aria-hidden="true">—</span>
      <p>{label}</p>
    </div>
  );
}
