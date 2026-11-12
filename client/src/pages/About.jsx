import { APP_NAME, APP_TAGLINE, AUTHOR, IDE, TECH_STACK } from '../meta.js';
import PageHeader from '../components/PageHeader.jsx';

const FEATURES = [
  'QR code check-in for fast, contactless attendance at events with automatic time-in/time-out tracking (Early, On-time, Late, Absent).',
  'Printable student ID cards with QR codes (85.6 × 54 mm, CR80), printable QR sheets, and bulk student import from CSV.',
  'Student management with status tracking (Active, Inactive, Deceased, Dropped, LOA, Regular, Irregular) to keep records accurate.',
  'Dashboards for essential attendance summaries, plus detailed Reports & Insights with visual charts, trend views (daily/weekly/monthly), and PDF export.',
  'Intervention tracking for students flagged for excessive absences or tardiness (including consecutive and accumulated cases), with proof of actions taken.',
  'Cause categories and details (medical, family, and other concerns) to better understand attendance issues and support CARES reporting.',
  'AI-assisted, simple-English suggestions for cause details, intervention actions, and auto-generated intervention summaries for easier documentation.',
  'Secure authentication, role-based access, audit-friendly records, and CSV export for reporting.',
];

export default function About() {
  return (
    <div className="page about-page">
      <PageHeader
        eyebrow="About"
        title={APP_NAME}
        subtitle={APP_TAGLINE}
      />

      <div className="grid-2">
        <div className="card">
          <div className="dash-card-head">
            <div>
              <h3>What it does</h3>
              <p className="muted small">Attendance made quick, accurate, and auditable.</p>
            </div>
          </div>
          <ul className="about-list">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="dash-card-head">
            <div>
              <h3>Tech stack</h3>
              <p className="muted small">Built for reliability on and off campus.</p>
            </div>
          </div>
          <div className="tech-grid">
            {TECH_STACK.map((t) => (
              <div key={t.group} className="tech-group">
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
        </div>
      </div>

      <div className="card">
        <div className="dash-card-head">
          <div>
            <h3>Credits</h3>
            <p className="muted small">The people and tools behind AttendX.</p>
          </div>
        </div>
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
    </div>
  );
}
