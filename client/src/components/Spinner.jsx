export default function Spinner({ label = 'Loading…', size = 'md', variant }) {
  return (
    <div className={`spinner-wrap spinner-${size}${variant ? ` ${variant}` : ''}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
}
