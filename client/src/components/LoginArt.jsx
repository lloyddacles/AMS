// Decorative, on-theme illustration for the login screen. Pure inline SVG so it
// needs no external assets and stays crisp at any size (and works offline/PWA).

const QR_MODULES = [
  [4, 0], [5, 0], [6, 0],
  [3, 1], [6, 1], [7, 1],
  [4, 2], [5, 2], [7, 2],
  [3, 3], [5, 3], [7, 3], [8, 3], [9, 3], [10, 3],
  [4, 4], [5, 4], [6, 4], [8, 4], [10, 4],
  [3, 5], [4, 5], [6, 5], [7, 5], [9, 5], [10, 5],
  [4, 6], [5, 6], [6, 6], [8, 6], [10, 6],
  [3, 7], [5, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [4, 8], [5, 8], [6, 8], [8, 8], [9, 8], [10, 8],
  [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9],
  [3, 10], [4, 10], [6, 10], [7, 10], [9, 10], [10, 10],
];

function QrFinder({ x, y }) {
  const cell = 8;
  return (
    <g>
      <rect x={x * cell} y={y * cell} width={cell * 3} height={cell * 3} rx="3" fill="none" stroke="#0f172a" strokeWidth="2.4" />
      <rect x={x * cell + cell} y={y * cell + cell} width={cell} height={cell} fill="#0f172a" />
    </g>
  );
}

function CheckMark({ cx, cy, r = 10, fill = '#34d399', stroke = '#ffffff' }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      <path d={`M ${cx - r * 0.45} ${cy} l ${r * 0.32} ${r * 0.34} l ${r * 0.6} ${-r * 0.6}`} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export default function LoginArt({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 600 460"
      role="img"
      aria-label="Illustration of QR-code attendance scanning with check-in records"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="la-scan" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="la-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* ambient glows */}
      <circle cx="140" cy="80" r="150" fill="rgba(56,189,248,0.12)" />
      <circle cx="480" cy="400" r="170" fill="rgba(99,102,241,0.14)" />

      {/* ---- calendar card ---- */}
      <g transform="translate(36,54)">
        <rect width="152" height="116" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" />
        <rect x="16" y="16" width="120" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        {[40, 62, 84].map((y) =>
          [16, 44, 72, 100, 128].map((x, i) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="20"
              height="12"
              rx="4"
              fill={y === 62 && i === 2 ? '#38bdf8' : 'rgba(255,255,255,0.16)'}
            />
          ))
        )}
      </g>

      {/* ---- attendance list card ---- */}
      <g transform="translate(24,246)">
        <rect width="178" height="162" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" />
        <rect x="16" y="18" width="80" height="9" rx="4" fill="rgba(255,255,255,0.32)" />
        <circle cx="34" cy="64" r="13" fill="rgba(255,255,255,0.22)" />
        <rect x="56" y="58" width="70" height="8" rx="4" fill="rgba(255,255,255,0.2)" />
        <CheckMark cx="150" cy="64" r="10" />
        <circle cx="34" cy="114" r="13" fill="rgba(255,255,255,0.22)" />
        <rect x="56" y="108" width="54" height="8" rx="4" fill="rgba(255,255,255,0.2)" />
        <CheckMark cx="150" cy="114" r="10" />
      </g>

      {/* ---- "Present" pill ---- */}
      <g transform="translate(426,66)">
        <rect width="146" height="46" rx="23" fill="rgba(52,211,153,0.16)" stroke="rgba(52,211,153,0.5)" />
        <CheckMark cx="28" cy="23" r="12" />
        <text x="50" y="29" fill="#a7f3d0" fontSize="18" fontWeight="600" fontFamily="Inter, system-ui, sans-serif">Present</text>
      </g>

      {/* ---- bar chart card ---- */}
      <g transform="translate(410,306)">
        <rect width="168" height="132" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" />
        {[[22, 76], [54, 58], [86, 40], [118, 22]].map(([x, h]) => (
          <rect key={x} x={x} y={110 - h} width="20" height={h} rx="6" fill="url(#la-bar)" />
        ))}
      </g>

      {/* ---- phone with QR scanner ---- */}
      <g transform="rotate(-5 300 230)">
        <rect x="212" y="46" width="176" height="368" rx="26" fill="rgba(15,23,42,0.5)" stroke="rgba(255,255,255,0.28)" strokeWidth="2" />
        <rect x="224" y="58" width="152" height="344" rx="18" fill="rgba(255,255,255,0.06)" />
        <rect x="284" y="68" width="32" height="5" rx="2.5" fill="rgba(255,255,255,0.35)" />

        {/* QR card */}
        <g transform="translate(246,150)">
          <rect width="128" height="128" rx="16" fill="#ffffff" />
          <g transform="translate(20,20)">
            <QrFinder x={0} y={0} />
            <QrFinder x={8} y={0} />
            <QrFinder x={0} y={8} />
            {QR_MODULES.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x * 8} y={y * 8} width="8" height="8" fill="#0f172a" />
            ))}
          </g>
          {/* viewfinder corners */}
          <path d="M22 10 H10 V22" fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M106 10 H118 V22" fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M10 106 V118 H22" fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M118 106 V118 H106" fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
          {/* animated scan line */}
          <rect className="la-scanline" x="15" y="14" width="98" height="3" rx="1.5" fill="url(#la-scan)" />
        </g>

        {/* progress + labels under the QR */}
        <rect x="246" y="300" width="128" height="10" rx="5" fill="rgba(255,255,255,0.12)" />
        <rect x="246" y="300" width="86" height="10" rx="5" fill="#34d399" />
        <rect x="246" y="326" width="92" height="8" rx="4" fill="rgba(255,255,255,0.22)" />
        <rect x="246" y="342" width="60" height="8" rx="4" fill="rgba(255,255,255,0.16)" />
      </g>
    </svg>
  );
}
