import { Router } from 'express';
import { batch, get, all, run } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { newToken } from '../services/users.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const selectFields = `id, student_no AS studentNo, first_name AS firstName,
  last_name AS lastName, email, course, year_level AS yearLevel, section, qr_token AS qrToken, created_at AS createdAt`;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

router.get('/', async (req, res) => {
  const { search } = req.query;
  let rows;
  if (search) {
    const like = `%${search}%`;
    rows = await all(
      `SELECT ${selectFields} FROM students
       WHERE student_no LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR course LIKE ?
       ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
      [like, like, like, like]
    );
  } else {
    rows = await all(`SELECT ${selectFields} FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`);
  }
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await get(`SELECT ${selectFields} FROM students WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { studentNo, firstName, lastName, email, course, yearLevel, section } = req.body || {};
  if (!studentNo || !firstName || !lastName) {
    return res.status(400).json({ error: 'Student number, first name and last name are required' });
  }
  try {
    const info = await run(
      `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, section, qr_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [studentNo.trim(), firstName.trim(), lastName.trim(), email || null, course || null, yearLevel || null, section || null, newToken()]
    );
    const row = await get(`SELECT ${selectFields} FROM students WHERE id = ?`, [info.lastInsertRowid]);
    await logAudit({
      user: req.user,
      action: 'student.create',
      entity: 'student',
      entityId: row.id,
      detail: `${row.studentNo} ${row.lastName}, ${row.firstName}`,
    });
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that student number already exists' });
    }
    throw err;
  }
});

// Bulk create / update. Accepts { students: [{...}], updateExisting: bool }.
// With updateExisting, rows whose student number already exists are updated in
// place (keeping their QR token); otherwise they are skipped. Reports every row.
router.post('/bulk', async (req, res) => {
  const rows = Array.isArray(req.body?.students) ? req.body.students : null;
  const updateExisting = req.body?.updateExisting === true;
  if (!rows) return res.status(400).json({ error: 'Expected an array of students' });
  if (rows.length === 0) return res.status(400).json({ error: 'No students to import' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Please import at most 1000 students at a time' });

  const skipped = [];
  const candidates = [];
  const seen = new Set();

  rows.forEach((raw, index) => {
    const line = raw.line ?? index + 1;
    const studentNo = String(raw.studentNo ?? '').trim();
    const firstName = String(raw.firstName ?? '').trim();
    const lastName = String(raw.lastName ?? '').trim();
    if (!studentNo || !firstName || !lastName) {
      skipped.push({ line, studentNo, reason: 'Missing student number, first name or last name' });
      return;
    }
    if (seen.has(studentNo)) {
      skipped.push({ line, studentNo, reason: 'Duplicate student number in this file' });
      return;
    }
    seen.add(studentNo);
    candidates.push({
      line,
      studentNo,
      firstName,
      lastName,
      email: raw.email ? String(raw.email).trim() : null,
      course: raw.course ? String(raw.course).trim() : null,
      yearLevel: raw.yearLevel ? String(raw.yearLevel).trim() : null,
      section: raw.section ? String(raw.section).trim() : null,
    });
  });

  // Find which candidate student numbers already exist (chunked to respect parameter limits).
  const existingByNo = new Map();
  for (const group of chunk(candidates.map((c) => c.studentNo), 400)) {
    if (!group.length) continue;
    const placeholders = group.map(() => '?').join(',');
    const found = await all(`SELECT id, student_no FROM students WHERE student_no IN (${placeholders})`, group);
    for (const r of found) existingByNo.set(r.student_no, r.id);
  }

  const created = [];
  const updated = [];
  const statements = [];
  for (const c of candidates) {
    if (existingByNo.has(c.studentNo)) {
      if (!updateExisting) {
        skipped.push({ line: c.line, studentNo: c.studentNo, reason: 'Student number already exists' });
        continue;
      }
      statements.push({
        sql: `UPDATE students SET first_name = ?, last_name = ?, email = ?, course = ?, year_level = ?, section = ?
              WHERE id = ?`,
        args: [c.firstName, c.lastName, c.email, c.course, c.yearLevel, c.section, existingByNo.get(c.studentNo)],
      });
      updated.push(c.studentNo);
      continue;
    }
    statements.push({
      sql: `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, section, qr_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.studentNo, c.firstName, c.lastName, c.email, c.course, c.yearLevel, c.section, newToken()],
    });
    created.push(c.studentNo);
  }

  if (statements.length) {
    await batch(statements, 'write');
  }

  await logAudit({
    user: req.user,
    action: 'student.bulk-import',
    entity: 'student',
    detail: `Imported ${created.length} new, updated ${updated.length}, skipped ${skipped.length}`,
  });

  res.status(201).json({
    createdCount: created.length,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    created,
    updated,
    skipped,
  });
});

router.put('/:id', async (req, res) => {
  const existing = await get('SELECT * FROM students WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  const { studentNo, firstName, lastName, email, course, yearLevel, section } = req.body || {};
  const nextStudentNo = String(studentNo ?? existing.student_no).trim();
  const nextFirstName = String(firstName ?? existing.first_name).trim();
  const nextLastName = String(lastName ?? existing.last_name).trim();
  if (!nextStudentNo || !nextFirstName || !nextLastName) {
    return res.status(400).json({ error: 'Student number, first name and last name are required' });
  }
  try {
    await run(
      `UPDATE students SET student_no = ?, first_name = ?, last_name = ?, email = ?, course = ?, year_level = ?, section = ?
       WHERE id = ?`,
      [
        nextStudentNo,
        nextFirstName,
        nextLastName,
        email ?? existing.email,
        course ?? existing.course,
        yearLevel ?? existing.year_level,
        section ?? existing.section,
        req.params.id,
      ]
    );
    const row = await get(`SELECT ${selectFields} FROM students WHERE id = ?`, [req.params.id]);
    const changes = [];
    if (existing.student_no !== row.studentNo) changes.push(`student no ${existing.student_no} → ${row.studentNo}`);
    if (existing.first_name !== row.firstName) changes.push(`first name ${existing.first_name} → ${row.firstName}`);
    if (existing.last_name !== row.lastName) changes.push(`last name ${existing.last_name} → ${row.lastName}`);
    if ((existing.course || '') !== (row.course || '')) changes.push(`course ${existing.course || '—'} → ${row.course || '—'}`);
    if ((existing.year_level || '') !== (row.yearLevel || '')) changes.push(`year ${existing.year_level || '—'} → ${row.yearLevel || '—'}`);
    if ((existing.section || '') !== (row.section || '')) changes.push(`section ${existing.section || '—'} → ${row.section || '—'}`);
    await logAudit({
      user: req.user,
      action: 'student.update',
      entity: 'student',
      entityId: row.id,
      detail: `${row.studentNo} ${row.lastName}, ${row.firstName}${changes.length ? ` · ${changes.join('; ')}` : ''}`,
    });
    res.json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that student number already exists' });
    }
    throw err;
  }
});

// Bulk QR regeneration. Body: { ids: number[] } to regenerate a selection, or
// { all: true } to regenerate every student. Admin-only (reissuing codes
// invalidates previously printed ID cards). Existing attendance is untouched.
router.post('/regenerate-qr', requireRole('admin'), async (req, res) => {
  const regenerateAll = req.body?.all === true;
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];

  if (!regenerateAll && ids.length === 0) {
    return res.status(400).json({ error: 'Provide student ids or set all: true' });
  }

  let targets;
  if (regenerateAll) {
    targets = await all('SELECT id FROM students');
  } else {
    if (ids.length > 5000) return res.status(400).json({ error: 'Too many students in one request (max 5000)' });
    const placeholders = ids.map(() => '?').join(',');
    targets = await all(`SELECT id FROM students WHERE id IN (${placeholders})`, ids);
  }

  if (targets.length === 0) {
    return res.status(404).json({ error: 'No matching students found' });
  }

  const statements = targets.map((t) => ({
    sql: 'UPDATE students SET qr_token = ? WHERE id = ?',
    args: [newToken(), t.id],
  }));
  await batch(statements, 'write');

  await logAudit({
    user: req.user,
    action: 'student.bulk-regenerate-qr',
    entity: 'student',
    detail: regenerateAll ? `Regenerated QR for all ${targets.length} student(s)` : `Regenerated QR for ${targets.length} student(s)`,
  });

  res.json({ count: targets.length, ids: targets.map((t) => t.id) });
});

router.post('/:id/regenerate-qr', async (req, res) => {
  const existing = await get('SELECT id FROM students WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  await run('UPDATE students SET qr_token = ? WHERE id = ?', [newToken(), req.params.id]);
  const row = await get(`SELECT ${selectFields} FROM students WHERE id = ?`, [req.params.id]);
  await logAudit({
    user: req.user,
    action: 'student.regenerate-qr',
    entity: 'student',
    entityId: row.id,
    detail: `${row.studentNo} ${row.lastName}, ${row.firstName}`,
  });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const student = await get(`SELECT ${selectFields} FROM students WHERE id = ?`, [req.params.id]);
  const info = await run('DELETE FROM students WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Student not found' });
  await logAudit({
    user: req.user,
    action: 'student.delete',
    entity: 'student',
    entityId: req.params.id,
    detail: student ? `${student.studentNo} ${student.lastName}, ${student.firstName}` : null,
  });
  res.json({ ok: true });
});

export default router;
