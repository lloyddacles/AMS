import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { displayStatus, todayInTz } from '../classify.js';
import { buildAtRisk, buildOverview } from '../services/reports.js';
import { maybeRunAutomation } from '../services/automation.js';
import { buildDailyBriefing } from '../services/briefing.js';
import { studentScopeFilter, eventScopeFilter } from '../services/academic.js';

const router = Router();
router.use(requireAuth);

const ATTENDED_SQL = "('early','on-time','late','present')";
// Students off an event's attendee list never count towards its numbers.
const ON_LIST_SQL = `NOT EXISTS (SELECT 1 FROM event_exclusions x WHERE x.event_id = a.event_id AND x.student_id = a.student_id)`;

function topAward(rank) {
  if (rank === 1) return { title: 'Gold Model Student', badge: 'Gold' };
  if (rank === 2) return { title: 'Silver Model Student', badge: 'Silver' };
  if (rank === 3) return { title: 'Bronze Model Student', badge: 'Bronze' };
  return { title: 'Excellence Awardee', badge: 'Award' };
}

function toYmd(d) {
  return d.toISOString().slice(0, 10);
}

function monthBounds(ymd) {
  const [y, m] = String(ymd).slice(0, 7).split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { year: y, month: m, startYmd: toYmd(start), endYmd: toYmd(end), daysInMonth: end.getUTCDate() };
}

function weekIndexForDate(startYmd, dateYmd) {
  const start = new Date(`${startYmd}T00:00:00Z`);
  const d = new Date(`${dateYmd}T00:00:00Z`);
  const diffDays = Math.floor((d - start) / 86400000);
  return Math.max(0, Math.floor(diffDays / 7));
}

function formatShortMd(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildCurrentMonthWeeklyTrend(eventsInMonth, monthStartYmd, monthEndYmd, daysInMonth) {
  const weekCount = Math.ceil(daysInMonth / 7);
  const buckets = Array.from({ length: weekCount }, (_, i) => {
    const ws = new Date(`${monthStartYmd}T00:00:00Z`);
    ws.setUTCDate(ws.getUTCDate() + i * 7);
    const we = new Date(ws);
    we.setUTCDate(ws.getUTCDate() + 6);
    const monthEnd = new Date(`${monthEndYmd}T00:00:00Z`);
    if (we > monthEnd) we.setTime(monthEnd.getTime());
    const wsYmd = toYmd(ws);
    const weYmd = toYmd(we);
    return {
      key: `week-${i + 1}`,
      label: `Week ${i + 1}`,
      name: `Week ${i + 1} (${formatShortMd(wsYmd)}–${formatShortMd(weYmd)})`,
      startDate: wsYmd,
      endDate: weYmd,
      events: 0,
      attended: 0,
    };
  });

  for (const e of eventsInMonth) {
    const idx = weekIndexForDate(monthStartYmd, e.eventDate);
    if (!buckets[idx]) continue;
    buckets[idx].events += 1;
    buckets[idx].attended += Number(e.attended || 0);
  }

  // Keep the chart readable by focusing on weeks up to the current week in the month
  // (and include future weeks in-month that already have scheduled events).
  const today = todayInTz();
  const currentIdx = today >= monthStartYmd && today <= monthEndYmd ? weekIndexForDate(monthStartYmd, today) : weekCount - 1;
  const lastRelevant = buckets.reduce((acc, b, i) => (b.events > 0 ? i : acc), currentIdx);
  return buckets.slice(0, Math.max(currentIdx, lastRelevant) + 1);
}

router.get('/stats', async (req, res) => {
  await maybeRunAutomation().catch(() => {});
  const scope = studentScopeFilter(req.user, { studentAlias: 's', programAlias: 'p_scope' });
  const eScope = eventScopeFilter(req.user, { eventAlias: 'e' });
  const studentRows = await all(
    `SELECT s.id FROM students s
     LEFT JOIN programs p ON p.id = s.program_id
     LEFT JOIN departments d ON d.id = COALESCE(s.department_id, p.department_id)
     ${scope.join}
     WHERE 1=1 ${scope.where}`,
    scope.params
  );
  const scopedIds = studentRows.map((r) => r.id);
  const scopedIdSet = new Set(scopedIds);
  const totalStudents = scopedIds.length;
  const totalEventsRow = await get(`SELECT COUNT(*) AS c FROM events e WHERE 1=1 ${eScope.where}`, eScope.params);
  const totalEvents = Number(totalEventsRow?.c || 0);

  const inClause = scopedIds.length ? `AND a.student_id IN (${scopedIds.map(() => '?').join(',')})` : 'AND 1=0';
  const totalRecords = scopedIds.length
    ? (await get(
        `SELECT COUNT(*) AS c
         FROM attendance a
         JOIN events e ON e.id = a.event_id
         WHERE a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL} ${inClause} ${eScope.where}`,
        [...scopedIds, ...eScope.params]
      )).c
    : 0;

  const events = await all(
    `SELECT e.id, e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime
     FROM events e WHERE 1=1 ${eScope.where}`,
    eScope.params
  );
  const scopedEventIds = events.map((e) => e.id);
  const records = (scopedIds.length && scopedEventIds.length)
    ? await all(
        `SELECT a.event_id AS eventId, a.student_id AS studentId, a.status, a.method, a.checked_in_at AS checkedInAt
         FROM attendance a
         WHERE a.student_id IN (${scopedIds.map(() => '?').join(',')})
           AND a.event_id IN (${scopedEventIds.map(() => '?').join(',')})`,
        [...scopedIds, ...scopedEventIds]
      )
    : [];
  const eventById = new Map(events.map((e) => [e.id, e]));
  const counts = { early: 0, 'on-time': 0, late: 0, absent: 0, excused: 0 };
  for (const r of records) {
    const cls = displayStatus(eventById.get(r.eventId), r) || 'on-time';
    counts[cls] = (counts[cls] || 0) + 1;
  }
  const statusBreakdown = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));

  const exclusions = scopedIds.length
    ? await all(`SELECT event_id AS eventId, student_id AS studentId FROM event_exclusions WHERE student_id IN (${scopedIds.map(() => '?').join(',')})`, scopedIds)
    : [];
  const exclusionsByEventId = new Map();
  for (const x of exclusions) {
    if (!exclusionsByEventId.has(x.eventId)) exclusionsByEventId.set(x.eventId, new Set());
    exclusionsByEventId.get(x.eventId).add(x.studentId);
  }

  const recentEventsRaw = await all(
    `SELECT e.id, e.name, e.event_date AS eventDate
     FROM events e WHERE 1=1 ${eScope.where}
     ORDER BY e.event_date DESC, e.id DESC LIMIT 5`,
    eScope.params
  );
  const recentIds = recentEventsRaw.map((e) => e.id);
  const recentAttendedRows = (scopedIds.length && recentIds.length)
    ? await all(
        `SELECT a.event_id AS eventId, COUNT(*) AS attended
         FROM attendance a
         WHERE a.event_id IN (${recentIds.map(() => '?').join(',')})
           AND a.student_id IN (${scopedIds.map(() => '?').join(',')})
           AND a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL}
         GROUP BY a.event_id`,
        [...recentIds, ...scopedIds]
      )
    : [];
  const recentAttendedMap = new Map(recentAttendedRows.map((r) => [r.eventId, Number(r.attended || 0)]));
  const recentEvents = recentEventsRaw.map((e) => {
    const excludedCount = (exclusionsByEventId.get(e.id) || new Set()).size;
    const denom = Math.max(0, totalStudents - excludedCount);
    const attended = recentAttendedMap.get(e.id) || 0;
    return { ...e, attended, totalStudents: denom, rate: denom ? Math.round((attended / denom) * 100) : 0 };
  });

  const today = todayInTz();
  const { startYmd: monthStartYmd, endYmd: monthEndYmd, daysInMonth, month, year } = monthBounds(today);
  const attendedSub = scopedIds.length
    ? `(SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.student_id IN (${scopedIds.map(() => '?').join(',')}) AND a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL})`
    : `0`;
  const monthEvents = await all(
    `SELECT e.id, e.name, e.event_date AS eventDate,
            ${attendedSub} AS attended
     FROM events e
     WHERE e.event_date >= ? AND e.event_date <= ? ${eScope.where}
     ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC`,
    [...(scopedIds.length ? scopedIds : []), monthStartYmd, monthEndYmd, ...eScope.params]
  );
  const trend = buildCurrentMonthWeeklyTrend(monthEvents, monthStartYmd, monthEndYmd, daysInMonth);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const atRisk = await buildAtRisk({ user: req.user });

  // Model students: consistent attendance with minimal/no absences and lates.
  // Past absences disqualify students from being recognized as top attendees.
  let topAttendees = [];
  try {
    const overview = await buildOverview({ user: req.user });
    const eligibleEvents = Math.min(3, Number(overview.totalEvents || 0));
    topAttendees = (overview.students || [])
      .map((s) => {
        const expected = Number(s.expected || 0);
        const attended = Number(s.attended || 0);
        const early = Number(s.early || 0);
        const onTime = Number(s.onTime || 0);
        const late = Number(s.late || 0);
        const absent = Number(s.absent || 0);
        const punctual = early + onTime;
        const punctualRate = expected ? Math.round((punctual / expected) * 100) : 0;
        return {
          id: s.id,
          studentNo: s.studentNo,
          firstName: s.firstName,
          lastName: s.lastName,
          course: s.course || '',
          yearLevel: s.yearLevel || '',
          attended,
          expected,
          early,
          onTime,
          punctual,
          late,
          absent,
          rate: Number(s.rate || 0),
          punctualRate,
        };
      })
      .filter((s) => s.expected >= eligibleEvents && s.absent === 0 && s.late <= 1 && s.rate >= 90)
      .sort((a, b) =>
        b.punctualRate - a.punctualRate ||
        b.rate - a.rate ||
        a.late - b.late ||
        a.absent - b.absent ||
        b.attended - a.attended ||
        String(a.lastName || '').localeCompare(String(b.lastName || ''), undefined, { sensitivity: 'base' }) ||
        String(a.firstName || '').localeCompare(String(b.firstName || ''), undefined, { sensitivity: 'base' })
      )
      .slice(0, 10)
      .map((s, i) => ({ ...s, rank: i + 1, award: topAward(i + 1) }));
  } catch {
    topAttendees = [];
  }

  const scopedEventIdSet = new Set(scopedEventIds);
  const totalExclusionsScoped = exclusions.filter((x) => scopedIdSet.has(x.studentId) && scopedEventIdSet.has(x.eventId)).length;
  // Every student × event slot except the ones taken off an attendee list.
  const expectedSlots = Math.max(0, totalStudents * totalEvents - totalExclusionsScoped);

  res.json({
    totalStudents,
    totalEvents,
    totalRecords,
    overallRate: expectedSlots ? Math.round((totalRecords / expectedSlots) * 100) : 0,
    statusBreakdown,
    recentEvents,
    topAttendees,
    trend,
    trendMeta: {
      granularity: 'week',
      month: `${year}-${String(month).padStart(2, '0')}`,
      monthLabel,
      startDate: monthStartYmd,
      endDate: monthEndYmd,
      scope: 'current-month',
    },
    atRisk: {
      threshold: atRisk.threshold,
      minEvents: atRisk.minEvents,
      count: atRisk.students.length,
      top: atRisk.students.slice(0, 5),
    },
  });
});

// Daily attendance assistant: briefing, watchlist, and intervention queue.
router.get('/briefing', async (req, res) => {
  await maybeRunAutomation().catch(() => {});
  try {
    const briefing = await buildDailyBriefing({ user: req.user });
    res.json(briefing);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not generate briefing' });
  }
});

export default router;
