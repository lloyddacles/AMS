import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api.js';
import LiveClock from '../components/LiveClock.jsx';

export default function Scanner() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [confirmValue, setConfirmValue] = useState('');
  const [commitError, setCommitError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState([]);
  const [today, setToday] = useState([]);
  const scannerRef = useRef(null);
  const pendingRef = useRef(null);
  const lastScan = useRef({ token: null, at: 0 });
  const confirmRef = useRef(null);

  async function loadToday() {
    try {
      const data = await api.getTodayAttendance();
      setToday(data.records);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    api.getEvent(id).then(setEvent).catch((e) => setError(e.message));
    loadToday();
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    pendingRef.current = pending;
    if (pending?.requireStudentConfirm) {
      setTimeout(() => confirmRef.current?.focus(), 50);
    }
  }, [pending]);

  async function startScanner() {
    setError('');
    const scanner = new Html5Qrcode('reader');
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onScan,
        () => {}
      );
      setScanning(true);
    } catch (e) {
      setError(`Could not start camera: ${e?.message || e}. Make sure camera access is allowed.`);
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (scanner && scanner.isScanning) {
      await scanner.stop().catch(() => {});
      scanner.clear();
    }
    setScanning(false);
  }

  async function onScan(decodedText) {
    if (pendingRef.current) return;
    const now = Date.now();
    if (lastScan.current.token === decodedText && now - lastScan.current.at < 2000) return;
    lastScan.current = { token: decodedText, at: now };

    try {
      const res = await api.lookupAttendance(Number(id), decodedText);
      setNotice('');
      setCommitError('');
      setConfirmValue('');
      setPending({ qrToken: decodedText, ...res });
      beep(res.nextAction === 'time-out' ? 660 : res.nextAction === 'already-complete' ? 400 : 880);
    } catch (e) {
      setNotice(e.message);
      beepError();
    }
  }

  async function commit() {
    if (!pending) return;
    setCommitting(true);
    setCommitError('');
    try {
      const res = await api.scanAttendance(
        Number(id),
        pending.qrToken,
        undefined,
        pending.requireStudentConfirm ? confirmValue : undefined
      );
      const labels = { 'time-in': 'timed in', 'time-out': 'timed out', 'already-complete': 'already completed' };
      if (res.action === 'time-in') setCount((c) => c + 1);
      setRecent((r) => [{ ...res, at: new Date().toLocaleTimeString() }, ...r].slice(0, 8));
      setNotice(`${res.firstName} ${res.lastName} ${labels[res.action] || 'recorded'} ✓`);
      beep(res.action === 'time-in' ? 880 : res.action === 'time-out' ? 660 : 400);
      loadToday();
      setPending(null);
      setConfirmValue('');
    } catch (e) {
      setCommitError(e.message);
      beepError();
    } finally {
      setCommitting(false);
    }
  }

  function cancel() {
    setPending(null);
    setConfirmValue('');
    setCommitError('');
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') cancel();
    }
    if (pending) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending]);

  const mode = event?.requireStudentConfirm ? 'kiosk' : 'staff';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to={`/events/${id}`} className="link back">← Event</Link>
          <h2>Scan Check-in</h2>
          <p className="muted">{event?.name}</p>
        </div>
        <div className="head-actions">
          <LiveClock className="scanner-clock" showDate={false} />
          <span className={`pill ${mode === 'kiosk' ? 'pill-blue' : 'pill-gray'}`}>
            {mode === 'kiosk' ? 'Kiosk mode · ID required' : 'Staff mode'}
          </span>
          <span className="pill pill-green">Checked in: {count}</span>
        </div>
      </div>

      {pending && (
        <div className={`confirm-card ${pending.nextAction === 'already-complete' ? 'warn' : ''}`}>
          <div className="confirm-info">
            <div className="confirm-name">{pending.student.lastName}, {pending.student.firstName}</div>
            <div className="muted">
              {pending.student.studentNo} · {pending.student.course || '—'} · {pending.student.yearLevel || '—'}
            </div>
            <div className="action-line">
              {pending.nextAction === 'time-in' && (
                <span className={`pill ${pending.plannedStatus === 'late' ? 'pill-amber' : pending.plannedStatus === 'early' ? 'pill-blue' : pending.plannedStatus === 'absent' ? 'pill-red' : 'pill-green'}`}>
                  Time In · {({ early: 'Early', 'on-time': 'On-time', late: 'Late', absent: 'Absent', present: 'Present' })[pending.plannedStatus] || 'Present'}
                </span>
              )}
              {pending.nextAction === 'time-out' && <span className="pill pill-blue">Time Out</span>}
              {pending.nextAction === 'already-complete' && <span className="pill pill-gray">Already timed out</span>}
              {pending.nextAction === 'time-out' && pending.checkedInAt && (
                <span className="muted small">in at {new Date(pending.checkedInAt + 'Z').toLocaleTimeString()}</span>
              )}
              {pending.eventClosed && <span className="pill pill-red">Check-in closed</span>}
            </div>
            {pending.nextAction === 'time-in' && !pending.windowBlocked && pending.lateAfterAt && (
              <div className="muted small">Late after {pending.lateAfterAt}</div>
            )}
            {pending.nextAction === 'time-out' && !pending.windowBlocked && pending.timeoutOpensAt && (
              <div className="muted small">Time-out opens at {pending.timeoutOpensAt}</div>
            )}
            {pending.windowMessage && <div className="alert alert-error">{pending.windowMessage}</div>}
          </div>

          {pending.requireStudentConfirm && (
            <div className="confirm-input">
              <label>Confirm identity — enter student number</label>
              <input
                ref={confirmRef}
                value={confirmValue}
                onChange={(e) => setConfirmValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
                placeholder="e.g. 2024-0001"
              />
              <span className="muted small">Tip: the last 4 digits are accepted.</span>
            </div>
          )}

          {commitError && <div className="alert alert-error">{commitError}</div>}

          <div className="confirm-actions">
            <button className="btn" onClick={cancel}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={commit}
              disabled={committing || pending.eventClosed || pending.windowBlocked || pending.nextAction === 'already-complete'}
            >
              {committing
                ? 'Recording…'
                : pending.nextAction === 'time-out'
                  ? 'Confirm Time Out'
                  : pending.nextAction === 'already-complete'
                    ? 'Already Completed'
                    : 'Confirm Time In'}
            </button>
          </div>
        </div>
      )}

      <div className="scanner-layout">
        <div className="card">
          <div id="reader" className="reader" />
          <div className="scanner-controls">
            {!scanning ? (
              <button className="btn btn-primary btn-block" onClick={startScanner}>Start Camera</button>
            ) : (
              <button className="btn btn-danger btn-block" onClick={stopScanner}>Stop Camera</button>
            )}
          </div>
          <p className="muted small center">
            {mode === 'kiosk'
              ? 'Student scans their QR, then types their student number to confirm.'
              : 'Point the camera at a student’s QR, then confirm the matched student.'}
          </p>
          {notice && <div className="alert alert-info">{notice}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>

        <div className="card">
          <h3>Today’s Check-ins</h3>
          <ul className="list">
            {today.length === 0 && <li className="muted small">No one has checked in yet today.</li>}
            {today.map((t, i) => (
              <li key={i} className="list-row">
                <div>
                  <div className="strong">{t.lastName}, {t.firstName}</div>
                  <div className="muted small">{t.eventName}</div>
                </div>
                <div className="scan-meta">
                  <span className="muted small">{t.checkedInAt ? new Date(t.checkedInAt + 'Z').toLocaleTimeString() : '—'}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function beep(duplicate) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = duplicate ? 500 : 880;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    /* ignore */
  }
}

function beepError() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 220;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* ignore */
  }
}
