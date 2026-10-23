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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function dateParts(value) {
  const parts = String(value || '').split('-');
  const month = Number(parts[1]);
  return {
    day: parts[2] || '—',
    month: MONTHS[month - 1] || '',
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDashboard().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!stats) {
    return (
      <div className="card">
        <Spinner label="Loading dashboard…" size="lg" variant="panel" />
      </div>
    );
  }

  const statusData = stats.statusBreakdown.map((s) => ({
    key: s.status,
    name: STATUS_LABELS[s.status] || s.status,
    value: s.count,
  }));
  const statusTotal = statusData.reduce((sum, s) => sum + s.value, 0);
  const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'there';

  return (
    <div className="page dashboard-page">
      <section className="dash-hero">
        <div className="dash-hero-copy">
          <span className="dash-eyebrow">Overview</span>
          <h2>{greeting()}, {firstName}</h2>
          <p className="muted">Here’s the latest snapshot of attendance across your events.</p>
        </div>
        <div className="dash-hero-actions">
          <Link to="/live" className="btn btn-primary">Live scan</Link>
          <Link to="/events" className="btn">Manage events</Link>
          <Link to="/reports" className="btn">Reports</Link>
        </div>
      </section>

      <div className="stat-grid">
        <StatCard
          icon="students"
          accent="blue"
          label="Students"
          value={stats.totalStudents}
          hint="Enrolled in the system"
        />
        <StatCard
          icon="events"
          accent="purple"
          label="Events"
          value={stats.totalEvents}
          hint="Recorded across all terms"
        />
        <StatCard
          icon="checkins"
          accent="green"
          label="Check-ins"
          value={stats.totalRecords}
          hint="Time-ins recorded"
        />
        <StatCard
          icon="rate"
          accent="amber"
          label="Overall rate"
          value={`${stats.overallRate}%`}
          hint="Average attendance"
        />
      </div>

      <div className="dash-charts">
        <section className="card dash-chart-card">
          <div className="dash-card-head">
            <div>
              <h3>Attendance per Event</h3>
              <p className="muted small">Check-ins for the latest events</p>
            </div>
            <Link className="link" to="/reports?view=trends">View trend</Link>
          </div>
          {stats.trend.length ? (
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={stats.trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashBarFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  dy={6}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.name || label}
                  formatter={(value) => [value, 'Attended']}
                />
                <Bar dataKey="attended" fill="url(#dashBarFill)" radius={[8, 8, 0, 0]} maxBarSize={46} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState label="No events yet." />
          )}
        </section>

        <section className="card dash-chart-card">
          <div className="dash-card-head">
            <div>
              <h3>Status Breakdown</h3>
              <p className="muted small">All recorded check-ins</p>
            </div>
          </div>
          {statusData.length ? (
            <>
              <div className="dash-donut">
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={94}
                      paddingAngle={2}
                      stroke="none"
                    >
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
                      <span
                        className="dash-legend-dot"
                        style={{ background: STATUS_COLORS[entry.key] || '#94a3b8' }}
                      />
                      <span className="dash-legend-label">{entry.name}</span>
                      <span className="dash-legend-value">{entry.value}</span>
                      <span className="dash-legend-pct">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyState label="No records yet." />
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="dash-card-head">
            <div>
              <h3>Recent Events</h3>
              <p className="muted small">Latest attendance activity</p>
            </div>
            <Link className="link" to="/events">View all</Link>
          </div>
          {stats.recentEvents.length ? (
            <ul className="dash-event-list">
              {stats.recentEvents.map((e) => {
                const { day, month } = dateParts(e.eventDate);
                return (
                  <li key={e.id} className="dash-event-row">
                    <span className="dash-date">
                      <strong>{day}</strong>
                      <span>{month}</span>
                    </span>
                    <div className="dash-event-main">
                      <Link className="dash-event-name" to={`/events/${e.id}`}>{e.name}</Link>
                      <div className="muted small">{e.attended} of {e.totalStudents} attended</div>
                    </div>
                    <div className="dash-event-rate">
                      <div className="rate-bar">
                        <span style={{ width: `${e.rate}%` }} />
                      </div>
                      <span className="rate-label">{e.rate}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState label="No events yet." />
          )}
        </section>

        <section className="card">
          <div className="dash-card-head">
            <div>
              <h3>Top Attendees</h3>
              <p className="muted small">Most consistent students</p>
            </div>
            <Link className="link" to="/reports">View reports</Link>
          </div>
          {stats.topAttendees.length ? (
            <ul className="dash-attendee-list">
              {stats.topAttendees.map((s, i) => (
                <li key={s.id} className="dash-attendee-row">
                  <span className={`dash-rank ${i < 3 ? `rank-${i + 1}` : ''}`}>{i + 1}</span>
                  <div className="dash-attendee-main">
                    <div className="strong">{s.lastName}, {s.firstName}</div>
                    <div className="muted small">{s.studentNo}</div>
                  </div>
                  <span className="pill pill-green">{s.attended} events</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState label="No attendance yet." />
          )}
        </section>
      </div>

      <section className="card dash-risk">
        <div className="dash-card-head">
          <div>
            <h3>At-Risk Students</h3>
            <p className="muted small">Below {stats.atRisk.threshold}% attendance</p>
          </div>
          <Link className="link" to="/reports?view=at-risk">View all</Link>
        </div>
        {stats.atRisk.count === 0 ? (
          <EmptyState
            label={
              stats.totalEvents === 0
                ? 'No students below the threshold yet — add events to start tracking.'
                : `No students below ${stats.atRisk.threshold}% attendance.`
            }
          />
        ) : (
          <>
            <div className="dash-risk-summary">
              <span className="dash-risk-badge">{stats.atRisk.count}</span>
              <span>
                student{stats.atRisk.count === 1 ? '' : 's'} below {stats.atRisk.threshold}% attendance
              </span>
            </div>
            <ul className="dash-risk-list">
              {stats.atRisk.top.map((s) => (
                <li key={s.id} className="dash-risk-row">
                  <div className="dash-attendee-main">
                    <div className="strong">{s.lastName}, {s.firstName}</div>
                    <div className="muted small">
                      {s.studentNo} · {s.attended} attended · {s.absent} absent
                    </div>
                  </div>
                  <div className="at-risk-right">
                    {typeof s.risk === 'number' && (
                      <span className={`risk-pill risk-${s.riskLevel}`} title="Explainable risk score">
                        {s.risk}%
                      </span>
                    )}
                    <div className="rate-wrap">
                      <div className="rate-bar danger"><span style={{ width: `${s.rate}%` }} /></div>
                      <span className="rate-label">{s.rate}%</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
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
