import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { newToken } from '../services/users.js';

const router = Router();
router.use(requireAuth);

const selectFields = `id, student_no AS studentNo, first_name AS firstName,
  last_name AS lastName, email, course, year_level AS yearLevel, section, qr_token AS qrToken, created_at AS createdAt`;

router.get('/', (req, res) => {
  const { search } = req.query;
  let rows;
  if (search) {
    const like = `%${search}%`;
    rows = db
      .prepare(
        `SELECT ${selectFields} FROM students
         WHERE student_no LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR course LIKE ?
         ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`
      )
      .all(like, like, like, like);
  } else {
    rows = db
      .prepare(`SELECT ${selectFields} FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`)
      .all();
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT ${selectFields} FROM students WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { studentNo, firstName, lastName, email, course, yearLevel, section } = req.body || {};
  if (!studentNo || !firstName || !lastName) {
    return res.status(400).json({ error: 'Student number, first name and last name are required' });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, section, qr_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(studentNo.trim(), firstName.trim(), lastName.trim(), email || null, course || null, yearLevel || null, section || null, newToken());
    const row = db.prepare(`SELECT ${selectFields} FROM students WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that student number already exists' });
    }
    throw err;
  }
});

// Bulk create. Accepts { students: [{...}] } and reports created vs skipped rows.
router.post('/bulk', (req, res) => {
  const rows = Array.isArray(req.body?.students) ? req.body.students : null;
  if (!rows) return res.status(400).json({ error: 'Expected an array of students' });
  if (rows.length === 0) return res.status(400).json({ error: 'No students to import' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Please import at most 1000 students at a time' });

  const insert = db.prepare(
    `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, section, qr_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const created = [];
  const skipped = [];

  const runBulk = db.transaction((list) => {
    list.forEach((raw, index) => {
      const studentNo = String(raw.studentNo ?? '').trim();
      const firstName = String(raw.firstName ?? '').trim();
      const lastName = String(raw.lastName ?? '').trim();
      const line = raw.line ?? index + 1;

      if (!studentNo || !firstName || !lastName) {
        skipped.push({ line, studentNo, reason: 'Missing student number, first name or last name' });
        return;
      }
      try {
        insert.run(
          studentNo,
          firstName,
          lastName,
          raw.email ? String(raw.email).trim() : null,
          raw.course ? String(raw.course).trim() : null,
          raw.yearLevel ? String(raw.yearLevel).trim() : null,
          raw.section ? String(raw.section).trim() : null,
          newToken()
        );
        created.push(studentNo);
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
          skipped.push({ line, studentNo, reason: 'Student number already exists' });
        } else {
          skipped.push({ line, studentNo, reason: 'Could not be imported' });
        }
      }
    });
  });

  runBulk(rows);
  res.status(201).json({ createdCount: created.length, skippedCount: skipped.length, created, skipped });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  const { studentNo, firstName, lastName, email, course, yearLevel, section } = req.body || {};
  const nextStudentNo = String(studentNo ?? existing.student_no).trim();
  const nextFirstName = String(firstName ?? existing.first_name).trim();
  const nextLastName = String(lastName ?? existing.last_name).trim();
  if (!nextStudentNo || !nextFirstName || !nextLastName) {
    return res.status(400).json({ error: 'Student number, first name and last name are required' });
  }
  try {
    db.prepare(
      `UPDATE students SET student_no = ?, first_name = ?, last_name = ?, email = ?, course = ?, year_level = ?, section = ?
       WHERE id = ?`
    ).run(
      nextStudentNo,
      nextFirstName,
      nextLastName,
      email ?? existing.email,
      course ?? existing.course,
      yearLevel ?? existing.year_level,
      section ?? existing.section,
      req.params.id
    );
    const row = db.prepare(`SELECT ${selectFields} FROM students WHERE id = ?`).get(req.params.id);
    res.json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that student number already exists' });
    }
    throw err;
  }
});

router.post('/:id/regenerate-qr', (req, res) => {
  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  db.prepare('UPDATE students SET qr_token = ? WHERE id = ?').run(newToken(), req.params.id);
  const row = db.prepare(`SELECT ${selectFields} FROM students WHERE id = ?`).get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Student not found' });
  res.json({ ok: true });
});

export default router;
