import { APP_NAME, APP_TAGLINE, AUTHOR, IDE, TECH_STACK } from '../meta.js';
import PageHeader from '../components/PageHeader.jsx';

const FEATURES = [
  'QR code check-in for fast, contactless attendance at events.',
  'Automatic time-in / time-out tracking, classified as Early, On-time, Late, or Absent.',
  'Classification: early before the start, on-time within 10 minutes of start, late within 60 minutes, absent beyond that or with no scan. Time-out opens 30 minutes before the event ends.',
  'Printable student ID cards with QR codes (85.6 × 54 mm, CR80).',
  'Bulk student import from CSV and printable QR sheets.',
  'Dashboards and reports with CSV export.',
  'Secure JWT authentication with hashed passwords.',
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
