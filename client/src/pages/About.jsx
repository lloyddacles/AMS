import { APP_NAME, APP_TAGLINE, AUTHOR, IDE, TECH_STACK } from '../meta.js';

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
      <div className="page-head">
        <div>
          <h2>About</h2>
          <p className="muted">About this application, its tech stack, and its author.</p>
        </div>
      </div>

      <div className="card about-hero">
        <span className="brand-mark lg">AM</span>
        <div>
          <h3>{APP_NAME}</h3>
          <p className="muted">{APP_TAGLINE}</p>
        </div>
      </div>

      <div className="card">
        <h3>What it does</h3>
        <ul className="about-list">
          {FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Tech stack</h3>
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

      <div className="card">
        <h3>Credits</h3>
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
