const ICONS = {
  users:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  calendar: 'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18 M8 14h.01 M12 14h.01 M16 14h.01',
  check: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  chart: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  live: 'M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M8.5 8.5a5 5 0 0 0 0 7 M15.5 8.5a5 5 0 0 1 0 7 M5 5a10 10 0 0 0 0 14 M19 5a10 10 0 0 1 0 14',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2',
  shield: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z M9 12l2 2 4-4',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3 M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  alert: 'M12 3l9 16H3z M12 9v4 M12 16h.01',
  repeat: 'M17 2l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  book: 'M4 3h14a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z M4 17h16 M8 7h8',
  layers: 'M12 2l9 5-9 5-9-5z M3 12l9 5 9-5 M3 17l9 5 9-5',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h8',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  star: 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z',
  key: 'M21 2l-2 2 M15 7l-2 2 M18 6l-3 3 M10.5 13.5a5 5 0 1 1-7 7 5 5 0 0 1 7-7z M10.5 13.5L21 3',
  filter: 'M3 4h18l-7 8v6l-4 2v-8z',
};

export default function StatCard({ icon = 'chart', accent = 'blue', label, value, hint }) {
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
            <path d={ICONS[icon] || ICONS.chart} />
          </svg>
        </span>
        <span className="dash-stat-label">{label}</span>
      </div>
      <div className="dash-stat-value">{value}</div>
      {hint && <div className="dash-stat-hint">{hint}</div>}
    </div>
  );
}
