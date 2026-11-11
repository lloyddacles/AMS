import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { displayStatus } from '../classify.js';
import { buildAtRisk, buildOverview } from '../services/reports.js';
import { maybeRunAutomation } from '../services/automation.js';
import { buildDailyBriefing } from '../services/briefing.js';

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

router.get('/stats', async (req, res) => {
  await maybeRunAutomation().catch(() => {});
  const totalStudents = (await get('SELECT COUNT(*) AS c FROM students')).c;
  const totalEvents = (await get('SELECT COUNT(*) AS c FROM events')).c;
  const totalRecords = (
    await get(`SELECT COUNT(*) AS c FROM attendance a WHERE a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL}`)
  ).c;
  const totalExclusions = (await get('SELECT COUNT(*) AS c FROM event_exclusions')).c;

  const events = await all('SELECT id, event_date AS eventDate, start_time AS startTime, end_time AS endTime FROM events');
  const records = await all('SELECT event_id AS eventId, status, method, checked_in_at AS checkedInAt FROM attendance');
  const eventById = new Map(events.map((e) => [e.id, e]));
  const counts = { early: 0, 'on-time': 0, late: 0, absent: 0, excused: 0 };
  for (const r of records) {
    const cls = displayStatus(eventById.get(r.eventId), r) || 'on-time';
    counts[cls] = (counts[cls] || 0) + 1;
  }
  const statusBreakdown = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));

  const recentEvents = (
    await all(
      `SELECT e.id, e.name, e.event_date AS eventDate,
              (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL}) AS attended,
              (SELECT COUNT(*) FROM students) - (SELECT COUNT(*) FROM event_exclusions x WHERE x.event_id = e.id) AS totalStudents
       FROM events e ORDER BY e.event_date DESC, e.id DESC LIMIT 5`
    )
  ).map((e) => ({
    ...e,
    rate: e.totalStudents ? Math.round((e.attended / e.totalStudents) * 100) : 0,
  }));

  const trend = await all(
    `SELECT substr(e.event_date, 6) AS label, e.name,
            (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL}) AS attended
     FROM events e ORDER BY e.event_date ASC, e.id ASC LIMIT 8`
  );

  const atRisk = await buildAtRisk({});

  // Model students: consistent attendance with minimal/no absences and lates.
  // Past absences disqualify students from being recognized as top attendees.
  let topAttendees = [];
  try {
    const overview = await buildOverview({});
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

  // Every student × event slot except the ones taken off an attendee list.
  const expectedSlots = Math.max(0, totalStudents * totalEvents - totalExclusions);

  res.json({
    totalStudents,
    totalEvents,
    totalRecords,
    overallRate: expectedSlots ? Math.round((totalRecords / expectedSlots) * 100) : 0,
    statusBreakdown,
    recentEvents,
    topAttendees,
    trend,
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
    const briefing = await buildDailyBriefing();
    res.json(briefing);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not generate briefing' });
  }
});

export default router;
