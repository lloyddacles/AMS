import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { newToken } from '../services/users.js';

const router = Router();
router.use(requireAuth);

const selectFields = `e.id, e.name, e.description, e.location,
  e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime,
  e.checkin_code AS checkinCode, e.status, e.require_student_confirm AS requireStudentConfirm,
  e.created_at AS createdAt,
  (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ('early','on-time','late','present')) AS attendanceCount,
  (SELECT COUNT(*) FROM students) AS totalStudents`;

function getEvent(id) {
  return get(`SELECT ${selectFields} FROM events e WHERE e.id = ?`, [id]);
}

router.get('/', async (req, res) => {
  const rows = await all(`SELECT ${selectFields} FROM events e ORDER BY e.event_date DESC, e.id DESC`);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await getEvent(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm } = req.body || {};
  if (!name || !eventDate) {
    return res.status(400).json({ error: 'Event name and date are required' });
  }
  const info = await run(
    `INSERT INTO events (name, description, location, event_date, start_time, end_time, checkin_code, status, require_student_confirm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name.trim(),
      description || null,
      location || null,
      eventDate,
      startTime || null,
      endTime || null,
      newToken(),
      status || 'active',
      requireStudentConfirm ? 1 : 0,
    ]
  );
  res.status(201).json(await getEvent(info.lastInsertRowid));
});

router.put('/:id', async (req, res) => {
  const existing = await get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm } = req.body || {};
  const nextName = String(name ?? existing.name).trim();
  const nextDate = String(eventDate ?? existing.event_date).trim();
  if (!nextName || !nextDate) {
    return res.status(400).json({ error: 'Event name and date are required' });
  }
  await run(
    `UPDATE events SET name = ?, description = ?, location = ?, event_date = ?,
      start_time = ?, end_time = ?, status = ?, require_student_confirm = ? WHERE id = ?`,
    [
      nextName,
      description ?? existing.description,
      location ?? existing.location,
      nextDate,
      startTime ?? existing.start_time,
      endTime ?? existing.end_time,
      status ?? existing.status,
      requireStudentConfirm === undefined ? existing.require_student_confirm : (requireStudentConfirm ? 1 : 0),
      req.params.id,
    ]
  );
  res.json(await getEvent(req.params.id));
});

router.post('/:id/regenerate-code', async (req, res) => {
  const existing = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  await run('UPDATE events SET checkin_code = ? WHERE id = ?', [newToken(), req.params.id]);
  res.json(await getEvent(req.params.id));
});

router.delete('/:id', async (req, res) => {
  const info = await run('DELETE FROM events WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Event not found' });
  res.json({ ok: true });
});

export default router;
