import { Router } from 'express';
import { all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Tokens make "maria santos" match first_name + last_name. Capped so a long
// query cannot generate an unreasonable number of LIKE clauses.
function tokens(query) {
  return String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
}

function tokenClause(columns, list) {
  return list
    .map(() => `(${columns.map((c) => `${c} LIKE ?`).join(' OR ')})`)
    .join(' AND ');
}

function tokenParams(columns, list) {
  return list.flatMap((token) => columns.map(() => `%${token}%`));
}

// One lightweight endpoint for the command palette: students, events,
// schedules, and terms in a single round trip. Everything is read-only.
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const empty = { query: q, students: [], events: [], schedules: [], terms: [] };
  const list = tokens(q);
  if (list.length === 0) return res.json(empty);

  const studentCols = ['student_no', 'first_name', 'last_name', 'email', 'course', 'section'];
  const eventCols = ['name', 'description', 'location', 'event_date'];
  const scheduleCols = ['name', 'description', 'location'];
  const termCols = ['name'];

  const [students, events, schedules, terms] = await Promise.all([
    all(
      `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
              course, year_level AS yearLevel, section
       FROM students
       WHERE ${tokenClause(studentCols, list)}
       ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
       LIMIT 8`,
      tokenParams(studentCols, list)
    ),
    all(
      `SELECT id, name, description, location, event_date AS eventDate,
              start_time AS startTime, end_time AS endTime, status, archived
       FROM events
       WHERE ${tokenClause(eventCols, list)}
       ORDER BY archived ASC,
                CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                event_date DESC, id DESC
       LIMIT 8`,
      tokenParams(eventCols, list)
    ),
    all(
      `SELECT id, name, description, location, weekdays,
              start_time AS startTime, end_time AS endTime, active
       FROM schedules
       WHERE ${tokenClause(scheduleCols, list)}
       ORDER BY active DESC, name COLLATE NOCASE
       LIMIT 6`,
      tokenParams(scheduleCols, list)
    ),
    all(
      `SELECT id, name, start_date AS startDate, end_date AS endDate, is_current AS isCurrent
       FROM terms
       WHERE ${tokenClause(termCols, list)}
       ORDER BY is_current DESC, start_date DESC
       LIMIT 5`,
      tokenParams(termCols, list)
    ),
  ]);

  res.json({ query: q, students, events, schedules, terms });
});

export default router;
