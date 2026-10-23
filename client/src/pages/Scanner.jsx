import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api.js';
import LiveClock from '../components/LiveClock.jsx';
import { useOffline } from '../offline/OfflineProvider.jsx';
import {
  savePack,
  getPack,
  enqueueScan,
  newClientScanId,
  getLocalState,
  saveLocalState,
  seedLocalState,
  getTodayCache,
  setTodayCache,
} from '../offline/store.js';
import { classifyByTime, timeoutOpensAt, formatTzTime } from '../offline/classify.js';

const ACTION_LABELS = {
  'time-in': 'timed in',
  'time-out': 'timed out',
  'already-complete': 'already completed',
};

const STATUS_PILL = {
  early: 'pill-cyan',
  'on-time': 'pill-green',
  present: 'pill-blue',
  late: 'pill-amber',
  absent: 'pill-red',
};

const STATUS_LABEL = {
  early: 'Early',
  'on-time': 'On-time',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
};

// Same token extraction the server does, so QR URLs and bare tokens both work.
function resolveToken(raw) {
  let token = String(raw || '').trim();
  const urlMatch = token.match(/[?&]token=([^&]+)/);
  if (urlMatch) token = decodeURIComponent(urlMatch[1]);
  return token;
}

// Mirrors the server's identity check (exact number or last 4 digits).
function studentNoMatches(provided, expected) {
  const p = String(provided || '').trim().toLowerCase().replace(/\s+/g, '');
  const e = String(expected || '').trim().toLowerCase();
  if (!p) return false;
  if (p === e) return true;
  const digits = e.replace(/\D/g, '');
  return digits.length >= 4 && p === digits.slice(-4);
}

// Server timestamps are "YYYY-MM-DD HH:MM:SS" (UTC); offline optimistic entries
// are full ISO strings. Normalise both for display.
function fmtTime(value) {
  if (!value) return '—';
  const s = String(value);
  return new Date(s.includes('T') ? s : `${s}Z`).toLocaleTimeString();
}

export default function Scanner() {
  const { id } = useParams();
  const { online, pending, syncing, syncNow, refreshPending } = useOffline();
  const [event, setEvent] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [pendingScan, setPendingScan] = useState(null);
  const [confirmValue, setConfirmValue] = useState('');
  const [commitError, setCommitError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [count, setCount] = useState(0);
  const [today, setToday] = useState([]);
  const [packReady, setPackReady] = useState(false);
  const scannerRef = useRef(null);
  const pendingRef = useRef(null);
  const lastScan = useRef({ token: null, at: 0 });
  const confirmRef = useRef(null);
  const packRef = useRef(null); // { event, students, attendance, timezone, tokenMap }
  // Auto-confirm preference: the event can turn it on for everyone; the staff
  // member can still override it for this device/session.
  const [autoPref, setAutoPref] = useState(() => {
    try { return localStorage.getItem('scanner:autoConfirm') === '1'; } catch { return false; }
  });
  const [autoOverride, setAutoOverride] = useState(null);
  const autoConfirm = autoOverride === null ? (!!event?.autoConfirm || autoPref) : autoOverride;
  useEffect(() => {
    try { localStorage.setItem('scanner:autoConfirm', autoPref ? '1' : '0'); } catch {}
  }, [autoPref]);
  function toggleAutoConfirm(next) {
    setAutoPref(next);
    setAutoOverride(next);
  }

  function indexPack(pack) {
    const tokenMap = {};
    for (const s of pack.students || []) tokenMap[s.qrToken] = s;
    return {
      ...pack,
      tokenMap,
      // Attendee list: students off it must not be scannable offline either.
      excludedSet: new Set(pack.excludedStudentIds || []),
    };
  }

  async function loadToday() {
    try {
      const data = await api.getTodayAttendance();
      setToday(data.records);
      setTodayCache(data.records);
    } catch {
      const cached = await getTodayCache().catch(() => null);
      if (cached?.records) setToday(cached.records);
    }
  }

  // Load the event + scan pack. Online this refreshes the offline cache; offline
  // it falls back to the last cached pack so scanning keeps working.
  async function loadData() {
    const eventId = Number(id);
    try {
      const [evt, pack] = await Promise.all([api.getEvent(eventId), api.getScanPack(eventId)]);
      const indexed = indexPack(pack);
      packRef.current = indexed;
      setEvent(evt);
      setPackReady(true);
      await savePack(indexed).catch(() => {});
      await seedLocalState(eventId, pack.attendance || []).catch(() => {});
    } catch (e) {
      const cached = await getPack(eventId).catch(() => null);
      if (cached) {
        packRef.current = indexPack(cached);
        setEvent(cached.event);
        setPackReady(true);
      } else if (e.network) {
        setError('This device has not cached event data yet. Connect to the internet once to enable offline scanning.');
      } else {
        setError(e.message);
      }
    }
  }

  useEffect(() => {
    setAutoOverride(null);
    loadData();
    loadToday();
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    pendingRef.current = pendingScan;
    if (pendingScan?.requireStudentConfirm) {
      setTimeout(() => confirmRef.current?.focus(), 50);
    }
  }, [pendingScan]);

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

    if (navigator.onLine) {
      try {
        const res = await api.lookupAttendance(Number(id), decodedText);
        setNotice('');
        setCommitError('');
        setConfirmValue('');
        setPendingScan({ qrToken: decodedText, ...res });
        beep(res.nextAction === 'time-out' ? 660 : res.nextAction === 'already-complete' ? 400 : 880);
        return;
      } catch (e) {
        if (!e.network) {
          setNotice(e.message);
          beepError();
          return;
        }
        // Network dropped mid-lookup — fall through to offline handling.
      }
    }

    await offlineLookup(decodedText);
  }

  async function offlineLookup(decodedText) {
    const pack = packRef.current;
    const token = resolveToken(decodedText);
    const student = pack?.tokenMap?.[token];
    if (!student) {
      setNotice(
        pack
          ? 'Unrecognized QR code (offline).'
          : 'Offline and no cached data for this event yet.'
      );
      beepError();
      return;
    }

    if (pack.excludedSet?.has(student.id)) {
      setNotice('Not on the attendee list for this event (offline).');
      beepError();
      return;
    }

    const eventId = Number(id);
    const localMap = (await getLocalState(eventId).catch(() => ({}))) || {};
    const st = localMap[String(student.id)] || {};
    const nextAction = !st.in ? 'time-in' : !st.out ? 'time-out' : 'already-complete';

    const tz = pack.timezone || 'Asia/Manila';
    let plannedStatus = null;
    let windowBlocked = false;
    let windowMessage = '';
    if (nextAction === 'time-in') {
      plannedStatus = classifyByTime(pack.event, new Date(), tz) || 'present';
    } else if (nextAction === 'time-out') {
      const opens = timeoutOpensAt(pack.event, tz);
      if (opens && new Date() < opens) {
        windowBlocked = true;
        windowMessage = `Time-out opens at ${formatTzTime(opens, tz)}.`;
      }
    }

    setNotice('');
    setCommitError('');
    setConfirmValue('');
    setPendingScan({
      qrToken: decodedText,
      offline: true,
      student,
      requireStudentConfirm: !!pack.event?.requireStudentConfirm,
      eventClosed: pack.event?.status !== 'active',
      nextAction,
      plannedStatus,
      windowBlocked,
      windowMessage,
      checkedInAt: st.in || null,
      timeoutOpensAt: formatTzTime(timeoutOpensAt(pack.event, tz), tz),
    });
    beep(nextAction === 'time-out' ? 660 : nextAction === 'already-complete' ? 400 : 880);
  }

  // Record a scan locally and queue it for the next sync.
  async function queueOffline(scan) {
    const eventId = Number(id);
    await enqueueScan(scan);
    const localMap = (await getLocalState(eventId).catch(() => ({}))) || {};
    const key = String(scan.studentId);
    const prev = localMap[key] || {};
    if (scan.action === 'time-out') localMap[key] = { ...prev, out: scan.scannedAt };
    else localMap[key] = { ...prev, in: prev.in || scan.scannedAt };
    await saveLocalState(eventId, localMap);
    await refreshPending();
    if (navigator.onLine) syncNow();
  }

  async function commit() {
    if (!pendingScan) return;
    const { requireStudentConfirm, offline, action, qrToken } = pendingScan;
    const studentId = pendingScan.student?.id;

    // Offline (or kiosk) confirmation check happens client-side before queueing.
    if (requireStudentConfirm && !studentNoMatches(confirmValue, pendingScan.student?.studentNo)) {
      setCommitError('Student number confirmation did not match this QR code');
      beepError();
      return;
    }

    setCommitting(true);
    setCommitError('');
    const scannedAt = new Date().toISOString();
    const clientScanId = newClientScanId();

    // Try the server first when we can reach it. Online scans rely on the
    // server clock (so the time-out window guard still applies); only the
    // offline queue passes a client timestamp.
    if (!offline && navigator.onLine) {
      try {
        const res = await api.scanAttendance(
          Number(id),
          qrToken,
          undefined,
          requireStudentConfirm ? confirmValue : undefined,
          { clientScanId }
        );
        if (res.action === 'time-in') setCount((c) => c + 1);
        setNotice(`${res.firstName} ${res.lastName} ${ACTION_LABELS[res.action] || 'recorded'} ✓`);
        beep(res.action === 'time-in' ? 880 : res.action === 'time-out' ? 660 : 400);
        loadToday();
        setPendingScan(null);
        setConfirmValue('');
        setCommitting(false);
        return;
      } catch (e) {
        if (!e.network) {
          setCommitError(e.message);
          beepError();
          setCommitting(false);
          return;
        }
        // Network drop at commit — queue it instead of losing the scan.
      }
    }

    // Offline path: queue locally with an optimistic confirmation.
    const student = pendingScan.student || {};
    const localAction = action || pendingScan.nextAction || 'time-in';
    await queueOffline({
      clientScanId,
      eventId: Number(id),
      qrToken,
      confirmValue: requireStudentConfirm ? confirmValue : undefined,
      scannedAt,
      studentId,
      action: localAction,
    });

    if (localAction === 'time-in') {
      setCount((c) => c + 1);
      setToday((t) =>
        [
          {
            firstName: student.firstName,
            lastName: student.lastName,
            eventName: event?.name,
            checkedInAt: scannedAt,
            pending: true,
          },
          ...t,
        ].slice(0, 100)
      );
    }
    setNotice(`${student.firstName || ''} ${student.lastName || ''} ${ACTION_LABELS[localAction] || 'recorded'} · saved offline`);
    beep(localAction === 'time-in' ? 880 : 660);
    setPendingScan(null);
    setConfirmValue('');
    setCommitting(false);
  }

  function cancel() {
    setPendingScan(null);
    setConfirmValue('');
    setCommitError('');
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') cancel();
      // Enter confirms the pending scan without reaching for the mouse.
      if (e.key === 'Enter' && !pendingScan?.requireStudentConfirm) {
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        commit();
      }
    }
    if (pendingScan) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pendingScan]);

  // Auto-confirm: when the staff member is watching the queue they do not need
  // to click "Confirm" for each student — the matched scan is committed on its
  // own so the next student can scan right away. Kiosk mode (student number
  // confirmation) is never auto-confirmed because the number must be typed.
  useEffect(() => {
    if (!pendingScan) return;
    if (!autoConfirm) return;
    if (pendingScan.requireStudentConfirm) return;
    if (pendingScan.eventClosed || pendingScan.windowBlocked) return;
    if (pendingScan.nextAction === 'already-complete') return;
    if (committing) return;
    const t = setTimeout(() => commit(), 200);
    return () => clearTimeout(t);
  }, [pendingScan, autoConfirm, committing]);

  const mode = event?.requireStudentConfirm ? 'kiosk' : 'staff';
  const offline = !online;

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
          {!event?.requireStudentConfirm && (
            <label className={`pill ${autoConfirm ? 'pill-green' : 'pill-gray'} scanner-toggle`}>
              <input
                type="checkbox"
                checked={autoConfirm}
                onChange={(e) => toggleAutoConfirm(e.target.checked)}
              />
              Auto-confirm
            </label>
          )}
          <span className="pill pill-green">Checked in: {count}</span>
        </div>
      </div>

      {offline && (
        <div className="offline-banner">
          <span className="sync-dot" />
          <div className="offline-banner-text">
            <strong>Offline mode</strong>
            <span className="muted small">
              Scans are saved on this device and sync automatically when you reconnect.
            </span>
          </div>
          {pending > 0 && <span className="pill pill-amber">{pending} queued</span>}
        </div>
      )}
      {!offline && pending > 0 && (
        <div className="offline-banner is-pending">
          <span className="sync-dot" />
          <div className="offline-banner-text">
            <strong>{syncing ? 'Syncing…' : 'Pending sync'}</strong>
            <span className="muted small">{pending} scan(s) waiting to upload</span>
          </div>
          {!syncing && (
            <button className="btn btn-sm btn-primary" onClick={syncNow}>
              Sync now
            </button>
          )}
        </div>
      )}

      {pendingScan && (
        <div className={`confirm-card ${pendingScan.nextAction === 'already-complete' ? 'warn' : ''}`}>
          <div className="confirm-info">
            <div className="confirm-name">
              {pendingScan.student?.lastName}, {pendingScan.student?.firstName}
            </div>
            <div className="muted">
              {pendingScan.student?.studentNo} · {pendingScan.student?.course || '—'} · {pendingScan.student?.yearLevel || '—'}
            </div>
            <div className="action-line">
              {pendingScan.nextAction === 'time-in' && (
                <span className={`pill ${STATUS_PILL[pendingScan.plannedStatus] || 'pill-green'}`}>
                  Time In · {STATUS_LABEL[pendingScan.plannedStatus] || 'Present'}
                </span>
              )}
              {pendingScan.nextAction === 'time-out' && <span className="pill pill-blue">Time Out</span>}
              {pendingScan.nextAction === 'already-complete' && <span className="pill pill-gray">Already timed out</span>}
              {pendingScan.nextAction === 'time-out' && pendingScan.checkedInAt && (
                <span className="muted small">in at {fmtTime(pendingScan.checkedInAt)}</span>
              )}
              {pendingScan.eventClosed && <span className="pill pill-red">Check-in closed</span>}
              {pendingScan.offline && <span className="pill pill-amber">Offline · will sync</span>}
              {autoConfirm && !pendingScan.requireStudentConfirm && !pendingScan.eventClosed && !pendingScan.windowBlocked && pendingScan.nextAction !== 'already-complete' && (
                <span className="pill pill-green">Auto-confirming…</span>
              )}
            </div>
            {pendingScan.nextAction === 'time-in' && !pendingScan.windowBlocked && pendingScan.lateAfterAt && (
              <div className="muted small">Late after {pendingScan.lateAfterAt}</div>
            )}
            {pendingScan.nextAction === 'time-out' && !pendingScan.windowBlocked && pendingScan.timeoutOpensAt && (
              <div className="muted small">Time-out opens at {pendingScan.timeoutOpensAt}</div>
            )}
            {pendingScan.windowMessage && <div className="alert alert-error">{pendingScan.windowMessage}</div>}
          </div>

          {pendingScan.requireStudentConfirm && (
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
              disabled={committing || pendingScan.eventClosed || pendingScan.windowBlocked || pendingScan.nextAction === 'already-complete'}
            >
              {committing
                ? 'Recording…'
                : pendingScan.nextAction === 'time-out'
                  ? 'Confirm Time Out'
                  : pendingScan.nextAction === 'already-complete'
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
              <button className="btn btn-primary btn-block" onClick={startScanner} disabled={!packReady && !event}>
                Start Camera
              </button>
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
                  <div className="muted small">
                    {t.eventName}
                    {t.pending ? ' · pending sync' : ''}
                  </div>
                </div>
                <div className="scan-meta">
                  <span className="muted small">{fmtTime(t.checkedInAt)}</span>
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
