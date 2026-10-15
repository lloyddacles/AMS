import '../styles.css';

export function SkeletonRow({ cols = 4 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="skeleton-line" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ margin: '0.5rem 0' }} />
      ))}
    </div>
  );
}
