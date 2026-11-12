import { Link } from 'react-router-dom';
import Footer from '../components/Footer.jsx';
import { APP_NAME, APP_TAGLINE } from '../meta.js';

const FEATURES = [
  {
    title: 'Fast QR Check-in',
    desc: 'Scan student QR codes for quick, accurate attendance with real-time status updates.',
    icon: '◉',
  },
  {
    title: 'Smart Reports & Insights',
    desc: 'Monitor attendance trends, risks, compliance, and program-level performance with clear summaries.',
    icon: '▤',
  },
  {
    title: 'Secure Role-Based Access',
    desc: 'Separate experiences for admins, staff, and students with scoped access and audit-ready actions.',
    icon: '⚙',
  },
  {
    title: 'Offline-Ready Scanning',
    desc: 'Continue scanning during connectivity issues and sync attendance records when back online.',
    icon: '⟳',
  },
];

const STEPS = [
  { label: 'Create events & schedules', desc: 'Set up attendance activities, terms, and scopes.' },
  { label: 'Scan and monitor', desc: 'Record check-ins live and track participation instantly.' },
  { label: 'Review and act', desc: 'Use reports, interventions, and corrections to support students.' },
];

export default function Landing() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <Link to="/" className="landing-brand" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark lg"><img src="/logo.png" alt={`${APP_NAME} logo`} /></span>
          <div>
            <strong>{APP_NAME}</strong>
            <span>{APP_TAGLINE}</span>
          </div>
        </Link>
        <nav className="landing-nav-actions">
          <Link to="/portal/login" className="btn btn-ghost">Student Portal</Link>
          <Link to="/login" className="btn btn-primary">Staff Sign In</Link>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero card">
          <div className="landing-hero-copy">
            <span className="dash-eyebrow">Modern Attendance Monitoring</span>
            <h1>Track attendance clearly.<br />Support students faster.</h1>
            <p className="muted">
              {APP_NAME} helps schools manage QR-based attendance, monitor participation, and generate actionable reports in one streamlined platform.
            </p>
            <div className="landing-cta-row">
              <Link to="/login" className="btn btn-primary btn-lg">Sign in as Staff/Admin</Link>
              <Link to="/portal/login" className="btn btn-lg">Open Student Portal</Link>
            </div>
            <div className="landing-quick-links">
              <Link to="/corrections" className="link">Request/lookup attendance correction</Link>
              <span className="muted">•</span>
              <Link to="/checkin" className="link" onClick={(e) => e.preventDefault()} aria-disabled="true" tabIndex={-1} style={{ pointerEvents: 'none', opacity: 0.6 }}>Public check-in via event link/code</Link>
            </div>
          </div>

          <div className="landing-hero-panel">
            <div className="landing-panel-card">
              <div className="landing-panel-kicker">What you can do</div>
              <ul className="landing-panel-list">
                <li><span>✓</span> Record attendance with QR scans and manual entries</li>
                <li><span>✓</span> Organize students, events, schedules, and colleges/programs</li>
                <li><span>✓</span> View reports, trends, risk flags, and interventions</li>
                <li><span>✓</span> Manage corrections, users, backups, and audit logs</li>
              </ul>
            </div>
            <div className="landing-stats-mini">
              <div className="landing-mini-stat"><strong>Live</strong><span>Monitoring</span></div>
              <div className="landing-mini-stat"><strong>Scoped</strong><span>Access</span></div>
              <div className="landing-mini-stat"><strong>Export</strong><span>Reports</span></div>
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="section-head">
            <h2>Built for efficient attendance operations</h2>
            <p className="muted">A modern workflow for admins, staff, and students.</p>
          </div>
          <div className="landing-feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="card landing-feature-card">
                <div className="landing-feature-icon" aria-hidden="true">{f.icon}</div>
                <h3>{f.title}</h3>
                <p className="muted">{f.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-steps-section card">
          <div className="section-head">
            <h2>How it works</h2>
            <p className="muted">Simple flow from setup to insights.</p>
          </div>
          <div className="landing-steps">
            {STEPS.map((s, i) => (
              <div key={s.label} className="landing-step">
                <div className="landing-step-num">{i + 1}</div>
                <div>
                  <h3>{s.label}</h3>
                  <p className="muted">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer compact />
    </div>
  );
}
