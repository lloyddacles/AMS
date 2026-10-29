export default function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <section className="dash-hero page-hero">
      <div className="dash-hero-copy">
        {eyebrow && <span className="dash-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="dash-hero-actions">{actions}</div>}
    </section>
  );
}
