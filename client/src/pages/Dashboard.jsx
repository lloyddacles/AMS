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
  Legend,
} from 'recharts';
import { api } from '../api.js';

const STATUS_COLORS = {
  early: '#0ea5e9',
  'on-time': '#16a34a',
  present: '#16a34a',
  late: '#f59e0b',
  excused: '#3b82f6',
  absent: '#ef4444',
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDashboard().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!stats) return <div className="muted">Loading dashboard…</div>;

  const statusData = stats.statusBreakdown.map((s) => ({ name: s.status, value: s.count }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Overview of attendance across all events.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Students" value={stats.totalStudents} accent="blue" />
        <StatCard label="Events" value={stats.totalEvents} accent="purple" />
        <StatCard label="Check-ins" value={stats.totalRecords} accent="green" />
        <StatCard label="Overall Rate" value={`${stats.overallRate}%`} accent="amber" />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Attendance per Event</h3>
          {stats.trend.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="attended" fill="#2563eb" radius={[6, 6, 0, 0]} name="Attended" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">No events yet.</p>
          )}
        </div>

        <div className="card">
          <h3>Status Breakdown</h3>
          {statusData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">No records yet.</p>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Recent Events</h3>
            <Link className="link" to="/events">View all</Link>
          </div>
          {stats.recentEvents.length ? (
            <ul className="list">
              {stats.recentEvents.map((e) => (
                <li key={e.id} className="list-row">
                  <div>
                    <Link className="link strong" to={`/events/${e.id}`}>{e.name}</Link>
                    <div className="muted small">{e.eventDate} · {e.attended}/{e.totalStudents} attended</div>
                  </div>
                  <div className="rate-wrap">
                    <div className="rate-bar">
                      <span style={{ width: `${e.rate}%` }} />
                    </div>
                    <span className="rate-label">{e.rate}%</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No events yet.</p>
          )}
        </div>

        <div className="card">
          <h3>Top Attendees</h3>
          {stats.topAttendees.length ? (
            <ul className="list">
              {stats.topAttendees.map((s, i) => (
                <li key={s.id} className="list-row">
                  <div className="rank-row">
                    <span className="rank">{i + 1}</span>
                    <div>
                      <div className="strong">{s.lastName}, {s.firstName}</div>
                      <div className="muted small">{s.studentNo}</div>
                    </div>
                  </div>
                  <span className="pill pill-green">{s.attended} events</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No attendance yet.</p>
          )}
        </div>
      </div>
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
