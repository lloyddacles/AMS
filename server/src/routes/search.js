import { Router } from 'express';
import { all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { studentScopeFilter, eventScopeFilter, scheduleScopeFilter } from '../services/academic.js';

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
// schedules, and terms in a single round trip. Scoped to the user's access.
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const empty = { query: q, students: [], events: [], schedules: [], terms: [] };
  const list = tokens(q);
  if (list.length === 0) return res.json(empty);

  const sScope = studentScopeFilter(req.user, { studentAlias: 's', programAlias: 'p_scope' });
  const eScope = eventScopeFilter(req.user, { eventAlias: 'e' });
  const schScope = scheduleScopeFilter(req.user, { scheduleAlias: 's' });

  const studentCols = ['s.student_no', 's.first_name', 's.last_name', 's.email', 's.course', 's.section'];
  const eventCols = ['e.name', 'e.description', 'e.location', 'e.event_date'];
  const scheduleCols = ['s.name', 's.description', 's.location'];
  const termCols = ['t.name'];

  const [students, events, schedules, terms] = await Promise.all([
    all(
      `SELECT s.id, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
              s.course, s.year_level AS yearLevel, s.section
       FROM students s
       LEFT JOIN programs p ON p.id = s.program_id
       LEFT JOIN departments d ON d.id = COALESCE(s.department_id, p.department_id)
       ${sScope.join}
       WHERE ${tokenClause(studentCols, list)} ${sScope.where}
       ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE
       LIMIT 8`,
      [...tokenParams(studentCols, list), ...sScope.params]
    ),
    all(
      `SELECT e.id, e.name, e.description, e.location, e.event_date AS eventDate,
              e.start_time AS startTime, e.end_time AS endTime, e.status, e.archived
       FROM events e
       WHERE ${tokenClause(eventCols, list)} ${eScope.where}
       ORDER BY e.archived ASC,
                CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
                e.event_date DESC, e.id DESC
       LIMIT 8`,
      [...tokenParams(eventCols, list), ...eScope.params]
    ),
    all(
      `SELECT s.id, s.name, s.description, s.location, s.weekdays,
              s.start_time AS startTime, s.end_time AS endTime, s.active
       FROM schedules s
       WHERE ${tokenClause(scheduleCols, list)} ${schScope.where}
       ORDER BY s.active DESC, s.name COLLATE NOCASE
       LIMIT 6`,
      [...tokenParams(scheduleCols, list), ...schScope.params]
    ),
    all(
      `SELECT t.id, t.name, t.start_date AS startDate, t.end_date AS endDate, t.is_current AS isCurrent
       FROM terms t
       WHERE ${tokenClause(termCols, list)}
       ORDER BY t.is_current DESC, t.start_date DESC
       LIMIT 5`,
      tokenParams(termCols, list)
    ),
  ]);

  res.json({ query: q, students, events, schedules, terms });
});

export default router;
