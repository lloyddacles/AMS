import { all } from '../db.js';
import { displayStatus, eventStart, eventPhase, todayInTz } from '../classify.js';
import { logicalUnits, seriesNameMap, aggregateUnit, unitEntries, recordsByEvent, cutoffsFor } from './series.js';
import { exclusionsByEvent } from './roster.js';

// Student-portal reads: one student's attendance history and dashboard across
// ALL past events (archived included — a student's record shouldn't disappear
// when staff archive an event). Off-list events are flagged, not hidden.
//
// Multi-day series are collapsed into one logical event in the history counts
// and dashboard summary; the UI shows a "Series / N days" badge per row.

const EVENT_COLS = `e.id, e.name, e.location, e.event_date AS eventDate,
  e.start_time AS startTime, e.end_time AS endTime, e.status, e.archived, e.series_id AS seriesId`;

function filters({ termId = null, from = '', to = '', q = '' } = {}) {
  const clauses = ['e.event_date <= ?'];
  const params = [todayInTz()];
  if (from) {
    clauses.push('e.event_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('e.event_date <= ?');
    params.push(to);
  }
  if (termId) {
    clauses.push('e.term_id = ?');
    params.push(Number(termId));
  }
  if (q) {
    clauses.push('(e.name LIKE ? OR e.location LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

// Everything the student's own rows depend on, in three tiny queries (no IN
// lists — a large school can exceed SQLite's bound-parameter limit).
async function studentContext(studentId) {
  const attendance = await all(
    `SELECT event_id AS eventId, status, method, checked_in_at AS checkedInAt, note
     FROM attendance WHERE student_id = ?`,
    [studentId]
  );
  const excludedEventIds = new Set(
    (await all('SELECT event_id AS eventId FROM event_exclusions WHERE student_id = ?', [studentId])).map(
      (r) => r.eventId
    )
  );
  const corrections = await all(
    `SELECT id, event_id AS eventId, requested_status AS requestedStatus, status, reason,
            resolution_note AS resolutionNote, reviewed_at AS reviewedAt, created_at AS createdAt
     FROM attendance_corrections
     WHERE student_id = ?
     ORDER BY id DESC`,
    [studentId]
  );
  const attByEvent = new Map(attendance.map((r) => [r.eventId, r]));
  const latestCorr = new Map();
  for (const c of corrections) if (!latestCorr.has(c.eventId)) latestCorr.set(c.eventId, c);
  return { attByEvent, excludedEventIds, latestCorr, corrections };
}

// Final display status for one event row:
  // excluded – off the attendee list (doesn't count anywhere)
  // pending  – event still open, nothing to classify yet
  // absent   – closed with no record (mirrors auto-absent at close)
  // early / on-time / late / excused / … – classified attendance
  function buildRow(e, ctx) {
  const att = ctx.attByEvent.get(e.id) || null;
  const corr = ctx.latestCorr.get(e.id) || null;
  const onList = !ctx.excludedEventIds.has(e.id);
  let status;
  if (!onList) status = 'excluded';
  else if (att) status = displayStatus(e, att) || (e.status === 'closed' ? 'absent' : 'pending');
  else status = e.status === 'closed' ? 'absent' : 'pending';

  const start = eventStart(e);
  const started = !start || start.getTime() <= Date.now();
  const pendingCorr = corr && corr.status === 'pending' ? corr : null;

  return {
    eventId: e.id,
    name: e.name,
    location: e.location,
    eventDate: e.eventDate,
    startTime: e.startTime,
    endTime: e.endTime,
    archived: Number(e.archived) ? 1 : 0,
    eventStatus: e.status,
    status,
    checkedInAt: att ? att.checkedInAt : null,
    method: att ? att.method : null,
    onList,
    correction: corr || null,
    canRequest: onList && started && !Number(e.archived) && !pendingCorr,
    seriesId: e.seriesId || null,
  };
}

function bucket(counts, status) {
  if (status === 'early') counts.early += 1;
  else if (status === 'on-time' || status === 'present') counts.onTime += 1;
  else if (status === 'late') counts.late += 1;
  else if (status === 'excused') counts.excused += 1;
  else if (status === 'pending') counts.pending += 1;
  else if (status === 'excluded') counts.excluded += 1;
  else counts.absent += 1;
}

function emptyCounts() {
  return { early: 0, onTime: 0, late: 0, excused: 0, absent: 0, pending: 0, excluded: 0 };
}

export async function dashboardFor(studentId) {
  const { sql, params } = filters();
  const events = await all(`SELECT ${EVENT_COLS} FROM events e ${sql}`, params);
  const seriesNames = await seriesNameMap();
  const ctx = await studentContext(studentId);
  const now = new Date();
  const units = logicalUnits(events, seriesNames);
  const sctx = {
    excluded: new Map(),
    records: recordsByEvent(
      Array.from(ctx.attByEvent.entries()).map(([eventId, a]) => ({ eventId, studentId, status: a.status, method: a.method, checked_in_at: a.checkedInAt }))
    ),
    cutoffs: cutoffsFor(events),
    now,
  };
  // excluded per student from context
  const exMap = await exclusionsByEvent(events.map((e) => e.id));
  for (const [eid, set] of exMap) {
    for (const sid of set) {
      if (sid === studentId) {
        if (!sctx.excluded.has(eid)) sctx.excluded.set(eid, new Set());
        sctx.excluded.get(eid).add(sid);
      }
    }
  }

  const counts = emptyCounts();
  for (const u of units) {
    const agg = aggregateUnit(unitEntries(u, studentId, sctx));
    if (!agg.expected) {
      // No expected days at all: the student is off the list for every day of
      // this logical event, so it lands in the excluded bucket (not hidden).
      const allExcluded = u.events.every((e) => sctx.excluded.get(e.id)?.has(studentId));
      if (allExcluded) counts.excluded += 1;
      continue;
    }
    if (agg.status) bucket(counts, agg.status);
    else {
      // pending if any day is still open and undecided; else absent
      let hasOpen = false;
      for (const e of u.events) {
        if (!sctx.excluded.has(e.id) || !sctx.excluded.get(e.id).has(studentId)) {
          if (e.status !== 'closed') hasOpen = true;
        }
      }
      if (hasOpen) counts.pending += 1;
      else counts.absent += 1;
    }
  }

  const attended = counts.early + counts.onTime + counts.late;
  const finalized = attended + counts.excused + counts.absent;
  const summary = {
    totalEvents: units.length,
    ...counts,
    attended,
    finalized,
    rate: finalized ? Math.round((attended / finalized) * 100) : 0,
    pendingCorrections: ctx.corrections.filter((c) => c.status === 'pending').length,
  };

  const upcoming = (await all(
    `SELECT ${EVENT_COLS} FROM events e
     WHERE e.status = 'active' AND e.archived = 0 AND e.event_date >= ?
     ORDER BY e.event_date, e.start_time, e.id
     LIMIT 10`,
    [todayInTz()]
  ))
    .filter((e) => !ctx.excludedEventIds.has(e.id))
    .slice(0, 5)
    .map((e) => ({
      eventId: e.id,
      name: e.name,
      location: e.location,
      eventDate: e.eventDate,
      startTime: e.startTime,
      endTime: e.endTime,
      phase: eventPhase(e),
    }));

  return { summary, upcoming };
}

export async function historyFor(studentId, { limit = 25, offset = 0, termId = null, from = '', to = '', q = '' } = {}) {
  const { sql, params } = filters({ termId, from, to, q });
  const events = await all(
    `SELECT ${EVENT_COLS} FROM events e ${sql} ORDER BY e.event_date DESC, e.id DESC`,
    params
  );
  const seriesNames = await seriesNameMap();
  const ctx = await studentContext(studentId);
  const now = new Date();
  const units = logicalUnits(events, seriesNames);
  const sctx = {
    excluded: new Map(),
    records: recordsByEvent(
      Array.from(ctx.attByEvent.entries()).map(([eventId, a]) => ({ eventId, studentId, status: a.status, method: a.method, checked_in_at: a.checkedInAt }))
    ),
    cutoffs: cutoffsFor(events),
    now,
  };
  const exMap2 = await exclusionsByEvent(events.map((e) => e.id));
  for (const [eid, set] of exMap2) {
    const uset = new Set();
    for (const sid of set) if (sid === studentId) uset.add(sid);
    if (uset.size) sctx.excluded.set(eid, uset);
  }

  // For history rows we show the primary day of the unit (matches order) but
  // collapse status across days.
  const unitRows = [];
  for (const u of units) {
    const agg = aggregateUnit(unitEntries(u, studentId, sctx));
    let status = agg.status;
    const onList = unitEntries(u, studentId, sctx).length > 0 || ![...sctx.excluded.values()].some((st) => st.has(studentId));
    // check if excluded on all days
    const allExcluded = u.events.every((e) => sctx.excluded.get(e.id) && sctx.excluded.get(e.id).has(studentId));
    if (allExcluded) status = 'excluded';
    else if (!status) {
      let hasOpen = false;
      for (const e of u.events) {
        if (!(sctx.excluded.get(e.id) && sctx.excluded.get(e.id).has(studentId))) {
          if (e.status !== 'closed') hasOpen = true;
        }
      }
      status = hasOpen ? 'pending' : 'absent';
    }
    const primary = u.primary;
    const bestDayId = agg.attendedDate
      ? (u.events.find((x) => String(x.eventDate) === String(agg.attendedDate))?.id || primary.id)
      : primary.id;
    const att2 = ctx.attByEvent.get(bestDayId) || ctx.attByEvent.get(primary.id);
    const corr = ctx.latestCorr.get(primary.id) || null;
    const start = eventStart(primary);
    const started = !start || start.getTime() <= Date.now();
    const pendingCorr = corr && corr.status === 'pending' ? corr : null;
    unitRows.push({
      eventId: primary.id,
      seriesId: u.seriesId || null,
      seriesDays: u.events.length,
      name: u.name,
      location: primary.location,
      eventDate: primary.eventDate,
      startTime: primary.startTime,
      endTime: primary.endTime,
      archived: Number(primary.archived) ? 1 : 0,
      eventStatus: primary.status,
      status,
      checkedInAt: att2 ? att2.checkedInAt : null,
      method: att2 ? att2.method : null,
      onList: !allExcluded,
      correction: corr || null,
      canRequest: !allExcluded && started && !Number(primary.archived) && !pendingCorr,
    });
  }

  const rows = unitRows;
  const counts = emptyCounts();
  for (const row of rows) bucket(counts, row.status);

  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  return { rows: rows.slice(off, off + lim), total: rows.length, counts };
}

export function listTerms() {
  return all(
    `SELECT id, name, start_date AS startDate, end_date AS endDate, is_current AS isCurrent
     FROM terms ORDER BY start_date DESC, id DESC`
  );
}
