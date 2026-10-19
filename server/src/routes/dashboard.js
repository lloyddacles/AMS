import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { displayStatus } from '../classify.js';
import { buildAtRisk } from '../services/reports.js';

const router = Router();
router.use(requireAuth);

const ATTENDED_SQL = "('early','on-time','late','present')";
// Students off an event's attendee list never count towards its numbers.
const ON_LIST_SQL = `NOT EXISTS (SELECT 1 FROM event_exclusions x WHERE x.event_id = a.event_id AND x.student_id = a.student_id)`;

router.get('/stats', async (req, res) => {
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

  const topAttendees = await all(
    `SELECT s.id, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
            COUNT(a.id) AS attended
     FROM students s JOIN attendance a ON a.student_id = s.id
     WHERE a.status IN ${ATTENDED_SQL}
     GROUP BY s.id ORDER BY attended DESC, s.last_name COLLATE NOCASE LIMIT 5`
  );

  const trend = await all(
    `SELECT substr(e.event_date, 6) AS label, e.name,
            (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ${ATTENDED_SQL} AND ${ON_LIST_SQL}) AS attended
     FROM events e ORDER BY e.event_date ASC, e.id ASC LIMIT 8`
  );

  const atRisk = await buildAtRisk({});

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

export default router;
