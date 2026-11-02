// Client-side mirror of the server's time classification, used when the scanner
// is offline so it can still show Early / On-time / Late and time-out windows.
// Thresholds come from the scan pack's cached settings so an admin policy
// change works offline too.

const DEFAULT_POLICY = {
  onTimeMaxMin: 10,
  lateMaxMin: 60,
  timeoutOpenBeforeEndMin: 30,
};
const MS_MIN = 60000;
const DEFAULT_TZ = 'Asia/Manila';

function timezoneOffsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const { type, value } of dtf.formatToParts(date)) parts[type] = value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

// Interpret a local date (YYYY-MM-DD) and time (HH:MM) in the app timezone.
export function zonedToDate(dateStr, timeStr, tz = DEFAULT_TZ) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [h, min] = String(timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h || 0, min || 0, 0);
  return new Date(guess - timezoneOffsetMs(new Date(guess), tz));
}

export function eventStart(event, tz = DEFAULT_TZ) {
  if (!event) return null;
  return zonedToDate(event.eventDate || event.event_date, event.startTime || event.start_time, tz);
}

export function eventEnd(event, tz = DEFAULT_TZ) {
  if (!event) return null;
  return zonedToDate(event.eventDate || event.event_date, event.endTime || event.end_time, tz);
}

export function timeoutOpensAt(event, tz = DEFAULT_TZ, policy) {
  const { timeoutOpenBeforeEndMin } = { ...DEFAULT_POLICY, ...(policy || {}) };
  const end = eventEnd(event, tz);
  return end ? new Date(end.getTime() - timeoutOpenBeforeEndMin * MS_MIN) : null;
}

export function classifyByTime(event, scannedAt, tz = DEFAULT_TZ, policy) {
  const { onTimeMaxMin, lateMaxMin } = { ...DEFAULT_POLICY, ...(policy || {}) };
  const start = eventStart(event, tz);
  const t = scannedAt instanceof Date ? scannedAt : new Date(scannedAt);
  if (!start || Number.isNaN(t.getTime())) return null;
  const diffMin = (t.getTime() - start.getTime()) / MS_MIN;
  if (diffMin < 0) return 'early';
  if (diffMin <= onTimeMaxMin) return 'on-time';
  if (diffMin <= lateMaxMin) return 'late';
  return 'absent';
}

export function formatTzTime(date, tz = DEFAULT_TZ) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
