import { APP_NAME, APP_TAGLINE, AUTHOR, IDE, TECH_STACK } from '../meta.js';

const HIGHLIGHTS = [
  { icon: '📲', title: 'Smart Check-in', desc: 'QR-based attendance with clear time-in/time-out tracking.' },
  { icon: '📊', title: 'Visual Insights', desc: 'Dashboards, charts, trends, and printable reports for quick understanding.' },
  { icon: '🧩', title: 'Intervention Support', desc: 'Flag concerns, record proof of actions, and document causes for CARES reporting.' },
  { icon: '🤖', title: 'AI-assisted Writing', desc: 'Simple-English suggestions for cause details, actions, and intervention summaries.' },
];

const FEATURES = [
  {
    title: 'Attendance & QR Tools',
    text: 'Fast QR check-in, automatic time-in/time-out status (Early, On-time, Late, Absent), printable student ID cards (CR80), QR sheets, and bulk CSV import.',
  },
  {
    title: 'Student & Records Management',
    text: 'Manage student information and statuses (Active, Inactive, Deceased, Dropped, LOA, Regular, Irregular) to keep attendance records accurate and meaningful.',
  },
  {
    title: 'Reports, Trends & Exports',
    text: 'Essential dashboard summaries plus detailed Reports & Insights with visual charts, daily/weekly/monthly trend views, PDF exports, and CSV reporting.',
  },
  {
    title: 'Interventions & Follow-up',
    text: 'Flag students for excessive or consecutive absences/tardiness, record interventions as proof, identify possible causes, and support follow-up for student care.',
  },
  {
    title: 'AI-assisted Documentation',
    text: 'Generate simple-English suggestions for cause details and intervention actions, plus auto-generated summaries to make CARES-ready documentation easier.',
  },
  {
    title: 'Secure & Reliable',
    text: 'Role-based access, secure authentication, audit-friendly records, and tools designed to support clear and dependable attendance monitoring.',
  },
];

export default function About() {
  return (
    <div className="page about-page">
      <section className="about-hero card">
        <div className="about-hero__content">
          <span className="about-eyebrow">About {APP_NAME}</span>
          <h1>{APP_NAME}</h1>
          <p className="about-tagline">{APP_TAGLINE}</p>
          <p className="about-intro">
            A modern attendance monitoring system that helps schools track attendance clearly, spot concerns early,
            and document interventions with confidence.
          </p>
          <div className="about-hero__chips">
            <span className="about-chip">QR Attendance</span>
            <span className="about-chip">Reports & Insights</span>
            <span className="about-chip">Intervention Tracking</span>
            <span className="about-chip">AI-assisted Summaries</span>
          </div>
        </div>
        <div className="about-hero__panel">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="about-highlight">
              <div className="about-highlight__icon" aria-hidden="true">{h.icon}</div>
              <div>
                <div className="about-highlight__title">{h.title}</div>
                <div className="about-highlight__desc">{h.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section">
        <div className="about-section-head">
          <h2>What {APP_NAME} can do</h2>
          <p className="muted">Designed to make attendance monitoring, reporting, and student support easier.</p>
        </div>
        <div className="about-feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="card about-feature-card">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="about-grid">
        <section className="card about-panel">
          <div className="about-section-head compact">
            <h2>Tech stack</h2>
            <p className="muted">Built with modern web tools for a smooth and reliable experience.</p>
          </div>
          <div className="tech-grid about-tech-grid">
            {TECH_STACK.map((t) => (
              <div key={t.group} className="tech-group about-tech-group">
                <div className="tech-group__title">{t.group}</div>
                <div className="tech-tags">
                  {t.items.map((item) => (
                    <span key={item} className="tech-tag">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card about-panel about-credits-panel">
          <div className="about-section-head compact">
            <h2>Credits</h2>
            <p className="muted">The people and tools behind {APP_NAME}.</p>
          </div>
          <div className="about-credits">
            <div className="credit-row">
              <span className="credit-label">Designed &amp; developed by</span>
              <span className="credit-value">{AUTHOR}</span>
            </div>
            <div className="credit-row">
              <span className="credit-label">Built with</span>
              <span className="credit-value">{IDE} IDE</span>
            </div>
            <div className="credit-row">
              <span className="credit-label">Copyright</span>
              <span className="credit-value">© {new Date().getFullYear()} {AUTHOR} · All Rights Reserved.</span>
            </div>
          </div>
          <div className="about-note">
            Made to support clear attendance records, timely follow-up, and better student care.
          </div>
        </section>
      </div>
    </div>
  );
}
