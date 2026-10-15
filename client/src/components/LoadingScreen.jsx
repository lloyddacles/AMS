export default function LoadingScreen({ label = 'Preparing your dashboard' }) {
  return (
    <div className="loader-screen" role="status" aria-live="polite">
      <div className="loader-inner">
        <div className="loader-logo">
          <img src="/logo.png" alt="" />
        </div>
        <div className="loader-brand">AttendX</div>
        <div className="loader-tag">Attendance Monitoring</div>
        <div className="loader-bar"><span /></div>
        {label && <div className="loader-label">{label}</div>}
      </div>
    </div>
  );
}
