import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/stats', (req, res) => {
  const totalStudents = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
  const totalEvents = db.prepare('SELECT COUNT(*) AS c FROM events').get().c;
  const totalRecords = db.prepare("SELECT COUNT(*) AS c FROM attendance WHERE status IN ('present','late')").get().c;
  const present = totalRecords;

  const statusBreakdown = db
    .prepare('SELECT status, COUNT(*) AS count FROM attendance GROUP BY status')
    .all();

  const recentEvents = db
    .prepare(
      `SELECT e.id, e.name, e.event_date AS eventDate, e.status,
              (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ('present','late')) AS attended,
              (SELECT COUNT(*) FROM students) AS totalStudents
       FROM events e ORDER BY e.event_date DESC, e.id DESC LIMIT 5`
    )
    .all()
    .map((e) => ({
      ...e,
      rate: e.totalStudents ? Math.round((e.attended / e.totalStudents) * 100) : 0,
    }));

  const topAttendees = db
    .prepare(
      `SELECT s.id, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
              COUNT(a.id) AS attended
       FROM students s JOIN attendance a ON a.student_id = s.id
       GROUP BY s.id ORDER BY attended DESC, s.last_name COLLATE NOCASE LIMIT 5`
    )
    .all();

  const trend = db
    .prepare(
      `SELECT substr(e.event_date, 6) AS label, e.name,
              (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS attended
       FROM events e ORDER BY e.event_date ASC, e.id ASC LIMIT 8`
    )
    .all();

  res.json({
    totalStudents,
    totalEvents,
    totalRecords,
    overallRate: totalStudents && totalEvents ? Math.round((present / (totalStudents * totalEvents)) * 100) : 0,
    statusBreakdown,
    recentEvents,
    topAttendees,
    trend,
  });
});

export default router;
