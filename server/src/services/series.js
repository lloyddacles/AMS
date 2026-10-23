import { all } from '../db.js';
import { displayStatus, absentCutoff } from '../classify.js';

// Multi-day / continuation events. Each day is its own event record (own QR,
// time window, attendee list, attendance rows), but events sharing a
// series_id collapse into ONE logical event everywhere reports or stats
// count events — the per-day detail lives inside the unit.

const ATTENDED_RANK = { early: 3, 'on-time': 2, present: 2, late: 1 };

export async function seriesNameMap() {
  const rows = await all('SELECT id, name FROM event_series');
  return new Map(rows.map((r) => [r.id, r.name]));
}

// Group event rows (already fetched) into logical units: standalone events
// keep their own unit; series members merge into one unit ordered by day.
export function logicalUnits(events, seriesNames = new Map()) {
  const units = [];
  const bySeries = new Map();
  for (const e of events) {
    if (e.seriesId) {
      let unit = bySeries.get(e.seriesId);
      if (!unit) {
        unit = { key: `series-${e.seriesId}`, seriesId: e.seriesId, events: [] };
        bySeries.set(e.seriesId, unit);
        units.push(unit);
      }
      unit.events.push(e);
    } else {
      units.push({ key: `event-${e.id}`, seriesId: null, events: [e] });
    }
  }
  for (const unit of units) {
    unit.events.sort(
      (a, b) =>
        String(a.eventDate ?? a.event_date).localeCompare(String(b.eventDate ?? b.event_date)) ||
        (a.id ?? 0) - (b.id ?? 0)
    );
    unit.primary = unit.events[0];
    unit.date = unit.primary.eventDate ?? unit.primary.event_date;
    unit.name = (unit.seriesId ? seriesNames.get(unit.seriesId) : null) || unit.primary.name;
  }
  return units;
}

// Collapse one student's per-day statuses (the days they are expected on)
// into a single logical status. Priority: attended (best day: early >
// on-time/present > late) > excused > absent (every day decided) > pending.
export function aggregateUnit(entries) {
  if (!entries.length) return { expected: false, status: null, attendedDate: null };
  let bestStatus = null;
  let bestRank = 0;
  let attendedDate = null;
  let excused = false;
  let allDecided = true;
  for (const { status, date } of entries) {
    if (!status) {
      allDecided = false;
      continue;
    }
    const rank = ATTENDED_RANK[status];
    if (rank !== undefined) {
      if (rank > bestRank) {
        bestRank = rank;
        bestStatus = status;
      }
      if (!attendedDate || String(date) > String(attendedDate)) attendedDate = date;
    } else if (status === 'excused') {
      excused = true;
    }
  }
  if (bestStatus) return { expected: true, status: bestStatus, attendedDate };
  if (excused) return { expected: true, status: 'excused', attendedDate: null };
  if (allDecided) return { expected: true, status: 'absent', attendedDate: null };
  return { expected: true, status: null, attendedDate: null };
}

// One student's expected-day statuses for one unit.
// ctx: { excluded: Map eventId→Set, records: Map eventId→Map studentId→record,
//        cutoffs: Map eventId→Date|null, now: Date }
export function unitEntries(unit, studentId, ctx) {
  const entries = [];
  for (const e of unit.events) {
    const out = ctx.excluded.get(e.id);
    if (out && out.has(studentId)) continue;
    const rec = ctx.records.get(e.id)?.get(studentId);
    const cls = rec
      ? displayStatus(e, rec)
      : ctx.cutoffs.get(e.id) && ctx.now > ctx.cutoffs.get(e.id)
        ? 'absent'
        : null;
    entries.push({ status: cls, date: e.eventDate ?? e.event_date });
  }
  return entries;
}

// Shared lookup contexts for reports/risk/portal.
export function recordsByEvent(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.eventId)) map.set(r.eventId, new Map());
    map.get(r.eventId).set(r.studentId, r);
  }
  return map;
}

export function cutoffsFor(events) {
  return new Map(events.map((e) => [e.id, absentCutoff(e)]));
}
