import { config } from './config.js';

const TIMEZONE = config.timezone;
const MS_MIN = 60000;

// Minutes after the event start used to classify a time-in.
const ON_TIME_MAX_MIN = 10; // 0–10 min after start = on-time
const LATE_MAX_MIN = 60; // 10–60 min after start = late; beyond 60 = absent
const TIMEOUT_OPEN_BEFORE_END_MIN = 30; // time-out opens 30 min before the end

const ATTENDED = ['early', 'on-time', 'late', 'present'];

export const isAttendedStatus = (status) => ATTENDED.includes(status);

// Offset (in ms) of the configured timezone from UTC at a given instant.
function timezoneOffsetMs(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
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

// Interpret a local date (YYYY-MM-DD) and time (HH:MM) in the app timezone
// and return the corresponding UTC instant.
export function zonedToDate(dateStr, timeStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [h, min] = String(timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h || 0, min || 0, 0);
  return new Date(guess - timezoneOffsetMs(new Date(guess)));
}

export function eventStart(event) {
  if (!event) return null;
  return zonedToDate(event.event_date || event.eventDate, event.start_time || event.startTime);
}

export function eventEnd(event) {
  if (!event) return null;
  return zonedToDate(event.event_date || event.eventDate, event.end_time || event.endTime);
}

// Time-out opens this many minutes before the event ends.
export function timeoutOpensAt(event) {
  const end = eventEnd(event);
  return end ? new Date(end.getTime() - TIMEOUT_OPEN_BEFORE_END_MIN * MS_MIN) : null;
}

// Instant after which a missing check-in counts as absent (start + 60 min).
export function absentCutoff(event) {
  const start = eventStart(event);
  return start ? new Date(start.getTime() + LATE_MAX_MIN * MS_MIN) : null;
}

// Today's date as YYYY-MM-DD in the app timezone.
export function todayInTz(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Format an instant as a local (timezone-aware) time like "8:30 AM".
export function formatTzTime(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

// Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") into a Date.
export function parseUtc(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

// Classify a time-in timestamp: early / on-time / late / absent.
// Returns null when there is no usable time-in or no event schedule.
export function classifyByTime(event, checkedInUtc) {
  const start = eventStart(event);
  const t = parseUtc(checkedInUtc);
  if (!start || !t) return null;
  const diffMin = (t.getTime() - start.getTime()) / MS_MIN;
  if (diffMin < 0) return 'early';
  if (diffMin <= ON_TIME_MAX_MIN) return 'on-time';
  if (diffMin <= LATE_MAX_MIN) return 'late';
  return 'absent';
}

// Best available classification for a stored attendance record. Manual marks
// are respected as-is; QR/self scans are classified by the time-in clock.
export function displayStatus(event, record) {
  if (!record) return null;
  if (record.method === 'manual') return record.status;
  if (record.status === 'excused') return 'excused';
  const byTime = classifyByTime(event, record.checked_in_at ?? record.checkedInAt);
  if (byTime) return byTime;
  if (record.status === 'absent') return 'absent';
  if (record.status === 'late') return 'late';
  return 'on-time'; // legacy "present" without a recorded time
}

// Coarse lifecycle phase of an event for display:
//   closed   – check-in has been turned off
//   upcoming – status is active but the start time hasn't been reached yet
//   active   – check-in is open (start time reached)
export function eventPhase(event, now = new Date()) {
  if (!event) return null;
  if (event.status && event.status !== 'active') return 'closed';
  const start = eventStart(event);
  if (start && start.getTime() > now.getTime()) return 'upcoming';
  return 'active';
}

export const CLASSIFY_LABEL = {
  early: 'Early',
  'on-time': 'On-time',
  late: 'Late',
  absent: 'Absent',
  present: 'Present',
  excused: 'Excused',
};
