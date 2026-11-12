import { Router } from 'express';
import { batch, get, all, run } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { newToken } from '../services/users.js';
import { logAudit } from '../services/audit.js';
import { validate, schemas } from '../validate.js';
import { studentScopeFilter } from '../services/academic.js';

const router = Router();
router.use(requireAuth);

const SELECT_FIELDS = `s.id, s.student_no AS studentNo, s.first_name AS firstName,
  s.last_name AS lastName, s.email, s.course, s.year_level AS yearLevel, s.section, s.status,
  s.qr_token AS qrToken, s.program_id AS programId, s.department_id AS departmentId,
  p.name AS programName, d.name AS departmentName,
  s.created_at AS createdAt`;

const BASE_FROM = `
  FROM students s
  LEFT JOIN programs p ON p.id = s.program_id
  LEFT JOIN departments d ON d.id = COALESCE(s.department_id, p.department_id)
`;

const STUDENT_STATUSES = ['Active', 'Inactive', 'Deceased', 'Dropped', 'LOA', 'Regular', 'Irregular'];

function normalizeStatus(value, fallback = 'Active') {
  const s = String(value ?? '').trim();
  if (!s) return fallback;
  const match = STUDENT_STATUSES.find((opt) => opt.toLowerCase() === s.toLowerCase());
  return match || fallback;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeIds(raw, max = 5000) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map((v) => Number(v)))].filter(
    (n) => Number.isInteger(n) && n > 0
  );
  return ids.length > max ? null : ids;
}

function buildScope(user, where = '1=1', params = []) {
  const scope = studentScopeFilter(user, { studentAlias: 's', programAlias: 'p_scope' });
  return {
    sql: `${BASE_FROM} ${scope.join} WHERE ${where} ${scope.where}`,
    params: [...params, ...scope.params],
  };
}

async function getScopedStudent(user, id) {
  const q = buildScope(user, 's.id = ?', [id]);
  return get(`SELECT ${SELECT_FIELDS} ${q.sql}`, q.params);
}

async function resolveProgramLink({ programId, course } = {}) {
  const pid = programId == null || programId === '' ? null : Number(programId);
  if (pid) {
    const prog = await get(
      `SELECT p.id, p.name, p.department_id AS departmentId
       FROM programs p WHERE p.id = ? AND p.active = 1`,
      [pid]
    );
    if (!prog) return { error: 'Selected program was not found' };
    const courseText = String(course || '').trim() || prog.name;
    return { ok: true, programId: prog.id, departmentId: prog.departmentId, course: courseText };
  }
  const courseText = String(course || '').trim();
  if (courseText) {
    const prog = await get(
      `SELECT p.id, p.name, p.department_id AS departmentId
       FROM programs p WHERE p.active = 1 AND LOWER(p.name) = LOWER(?) LIMIT 1`,
      [courseText]
    );
    if (prog) return { ok: true, programId: prog.id, departmentId: prog.departmentId, course: prog.name };
  }
  return { ok: true, programId: null, departmentId: null, course: courseText || null };
}

function canManageStudentForUser(user, target) {
  if (!user || user.role === 'admin') return true;
  // Staff with no assignment remain unrestricted (legacy behavior) unless scoped.
  if (!user.departmentId && !user.programId) return true;
  if (user.programId) {
    return Number(target.program_id || target.programId || 0) === Number(user.programId) ||
      (!target.program_id && !target.programId && Number(target.department_id || target.departmentId || 0) === Number(user.departmentId || 0));
  }
  if (user.departmentId) {
    return Number(target.department_id || target.departmentId || 0) === Number(user.departmentId);
  }
  return true;
}

router.get('/', async (req, res) => {
  const { search } = req.query;
  let q;
  if (search) {
    const like = `%${search}%`;
    q = buildScope(
      req.user,
      `(s.student_no LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.course LIKE ? OR s.section LIKE ? OR s.status LIKE ? OR p.name LIKE ? OR d.name LIKE ?)`,
      [like, like, like, like, like, like, like, like]
    );
  } else {
    q = buildScope(req.user, '1=1', []);
  }
  const rows = await all(
    `SELECT ${SELECT_FIELDS} ${q.sql} ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`,
    q.params
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await getScopedStudent(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(row);
});

router.post('/', validate(schemas.studentCreate), async (req, res) => {
  const { studentNo, firstName, lastName, email, course, yearLevel, section, status, programId } = req.body;
  const link = await resolveProgramLink({ programId, course });
  if (link.error) return res.status(400).json({ error: link.error });

  // For scoped staff, created students must fall within their scope.
  if (req.user.role !== 'admin' && (req.user.departmentId || req.user.programId)) {
    if (req.user.programId && Number(link.programId || 0) !== Number(req.user.programId)) {
      return res.status(403).json({ error: 'You can only add students to your assigned program' });
    }
    if (!req.user.programId && req.user.departmentId && Number(link.departmentId || 0) !== Number(req.user.departmentId)) {
      return res.status(403).json({ error: 'You can only add students to your assigned department' });
    }
  }

  try {
    const info = await run(
      `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, section, status, qr_token, program_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(studentNo).trim(),
        String(firstName).trim(),
        String(lastName).trim(),
        email || null,
        link.course || null,
        yearLevel || null,
        section || null,
        normalizeStatus(status),
        newToken(),
        link.programId,
        link.departmentId,
      ]
    );
    const row = await getScopedStudent(req.user, info.lastInsertRowid);
    await logAudit({
      user: req.user,
      action: 'student.create',
      entity: 'student',
      entityId: row.id,
      detail: `${row.studentNo} ${row.lastName}, ${row.firstName} · ${row.status}${row.departmentName ? ` · ${row.departmentName}` : ''}${row.programName ? ` / ${row.programName}` : ''}`,
    });
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that student number already exists' });
    }
    throw err;
  }
});

router.post('/bulk', validate(schemas.studentBulk), async (req, res) => {
  const rows = req.body.students;
  const updateExisting = req.body.updateExisting === true;
  const skipped = [];
  const candidates = [];
  const seen = new Set();

  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index] || {};
    const line = raw.line ?? index + 1;
    const studentNo = String(raw.studentNo ?? '').trim();
    const firstName = String(raw.firstName ?? '').trim();
    const lastName = String(raw.lastName ?? '').trim();
    if (!studentNo || !firstName || !lastName) {
      skipped.push({ line, studentNo, reason: 'Missing student number, first name or last name' });
      continue;
    }
    if (seen.has(studentNo)) {
      skipped.push({ line, studentNo, reason: 'Duplicate student number in this file' });
      continue;
    }
    seen.add(studentNo);
    const link = await resolveProgramLink({ programId: raw.programId, course: raw.course });
    if (link.error) {
      skipped.push({ line, studentNo, reason: link.error });
      continue;
    }
    if (req.user.role !== 'admin' && (req.user.departmentId || req.user.programId)) {
      if (req.user.programId && Number(link.programId || 0) !== Number(req.user.programId)) {
        skipped.push({ line, studentNo, reason: 'Outside your assigned program scope' });
        continue;
      }
      if (!req.user.programId && req.user.departmentId && Number(link.departmentId || 0) !== Number(req.user.departmentId)) {
        skipped.push({ line, studentNo, reason: 'Outside your assigned department scope' });
        continue;
      }
    }
    candidates.push({
      line,
      studentNo,
      firstName,
      lastName,
      email: raw.email ? String(raw.email).trim() : null,
      course: link.course || null,
      yearLevel: raw.yearLevel ? String(raw.yearLevel).trim() : null,
      section: raw.section ? String(raw.section).trim() : null,
      status: normalizeStatus(raw.status),
      programId: link.programId,
      departmentId: link.departmentId,
    });
  }

  const existingByNo = new Map();
  for (const group of chunk(candidates.map((c) => c.studentNo), 400)) {
    if (!group.length) continue;
    const placeholders = group.map(() => '?').join(',');
    const found = await all(`SELECT id, student_no, program_id, department_id FROM students WHERE student_no IN (${placeholders})`, group);
    for (const r of found) existingByNo.set(r.student_no, r);
  }

  const created = [];
  const updated = [];
  const statements = [];
  for (const c of candidates) {
    const existing = existingByNo.get(c.studentNo);
    if (existing) {
      if (!updateExisting) {
        skipped.push({ line: c.line, studentNo: c.studentNo, reason: 'Student number already exists' });
        continue;
      }
      if (!canManageStudentForUser(req.user, existing)) {
        skipped.push({ line: c.line, studentNo: c.studentNo, reason: 'Outside your assigned scope' });
        continue;
      }
      statements.push({
        sql: `UPDATE students SET first_name = ?, last_name = ?, email = ?, course = ?, year_level = ?, section = ?, status = ?, program_id = ?, department_id = ? WHERE id = ?`,
        args: [c.firstName, c.lastName, c.email, c.course, c.yearLevel, c.section, c.status, c.programId, c.departmentId, existing.id],
      });
      updated.push(c.studentNo);
      continue;
    }
    statements.push({
      sql: `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, section, status, qr_token, program_id, department_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.studentNo, c.firstName, c.lastName, c.email, c.course, c.yearLevel, c.section, c.status, newToken(), c.programId, c.departmentId],
    });
    created.push(c.studentNo);
  }

  if (statements.length) await batch(statements, 'write');
  await logAudit({
    user: req.user,
    action: 'student.bulk-import',
    entity: 'student',
    detail: `Imported ${created.length} new, updated ${updated.length}, skipped ${skipped.length}`,
  });

  res.status(201).json({ createdCount: created.length, updatedCount: updated.length, skippedCount: skipped.length, created, updated, skipped });
});

router.post('/bulk-update', async (req, res) => {
  const ids = normalizeIds(req.body?.ids);
  if (!ids) return res.status(400).json({ error: 'Too many students in one request (max 5000)' });
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one student' });

  const patch = [];
  const raw = req.body || {};
  if (Object.prototype.hasOwnProperty.call(raw, 'course') || Object.prototype.hasOwnProperty.call(raw, 'programId')) {
    const link = await resolveProgramLink({ programId: raw.programId, course: raw.course });
    if (link.error) return res.status(400).json({ error: link.error });
    // If user is scoped, enforce scope for target program/department.
    if (req.user.role !== 'admin' && (req.user.departmentId || req.user.programId)) {
      if (req.user.programId && Number(link.programId || 0) !== Number(req.user.programId)) {
        return res.status(403).json({ error: 'You can only assign students within your assigned program' });
      }
      if (!req.user.programId && req.user.departmentId && Number(link.departmentId || 0) !== Number(req.user.departmentId)) {
        return res.status(403).json({ error: 'You can only assign students within your assigned department' });
      }
    }
    if (String(raw.course ?? '').trim() || raw.programId != null) {
      patch.push({ key: 'course', column: 'course', value: link.course || null });
      patch.push({ key: 'programId', column: 'program_id', value: link.programId });
      patch.push({ key: 'departmentId', column: 'department_id', value: link.departmentId });
    }
  }
  for (const [key, column] of [['yearLevel', 'year_level'], ['section', 'section']]) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = String(raw[key] ?? '').trim();
    if (!value) continue;
    patch.push({ key, column, value: value.slice(0, 120) });
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'status')) {
    const rawStatus = String(raw.status ?? '').trim();
    if (rawStatus) {
      const value = STUDENT_STATUSES.find((opt) => opt.toLowerCase() === rawStatus.toLowerCase());
      if (!value) return res.status(400).json({ error: `Status must be one of: ${STUDENT_STATUSES.join(', ')}` });
      patch.push({ key: 'status', column: 'status', value });
    }
  }
  if (patch.length === 0) {
    return res.status(400).json({ error: 'Provide a course/program, year level, section, or status to set' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const targets = await all(`SELECT id, program_id, department_id FROM students WHERE id IN (${placeholders})`, ids);
  const allowed = targets.filter((t) => canManageStudentForUser(req.user, t));
  if (allowed.length === 0) return res.status(404).json({ error: 'No matching students found in your scope' });

  const uniqPatch = [];
  const seenCols = new Set();
  for (const p of patch) {
    if (seenCols.has(p.column)) continue;
    seenCols.add(p.column);
    uniqPatch.push(p);
  }
  const statements = allowed.map((t) => ({
    sql: `UPDATE students SET ${uniqPatch.map((p) => `${p.column} = ?`).join(', ')} WHERE id = ?`,
    args: [...uniqPatch.map((p) => p.value), t.id],
  }));
  await batch(statements, 'write');

  const changes = uniqPatch.filter((p) => p.value != null && p.value !== '').map((p) => `${p.key} → ${p.value}`).join('; ');
  await logAudit({ user: req.user, action: 'student.bulk-update', entity: 'student', detail: `${allowed.length} student(s)${changes ? ` · ${changes}` : ''}` });
  res.json({ count: allowed.length, ids: allowed.map((t) => t.id) });
});

router.post('/bulk-delete', requireRole('admin'), async (req, res) => {
  const ids = normalizeIds(req.body?.ids);
  if (!ids) return res.status(400).json({ error: 'Too many students in one request (max 5000)' });
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one student' });
  const placeholders = ids.map(() => '?').join(',');
  const targets = await all(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName FROM students WHERE id IN (${placeholders})`,
    ids
  );
  if (targets.length === 0) return res.status(404).json({ error: 'No matching students found' });
  await batch(targets.map((t) => ({ sql: 'DELETE FROM students WHERE id = ?', args: [t.id] })), 'write');
  await logAudit({ user: req.user, action: 'student.bulk-delete', entity: 'student', detail: `${targets.length} student(s)` });
  res.json({ count: targets.length, ids: targets.map((t) => t.id) });
});

router.put('/:id', async (req, res) => {
  const existing = await get('SELECT * FROM students WHERE id = ?', [req.params.id]);
  if (!existing || !canManageStudentForUser(req.user, existing)) return res.status(404).json({ error: 'Student not found' });
  const { studentNo, firstName, lastName, email, course, yearLevel, section, status, programId } = req.body || {};
  const nextStudentNo = String(studentNo ?? existing.student_no).trim();
  const nextFirstName = String(firstName ?? existing.first_name).trim();
  const nextLastName = String(lastName ?? existing.last_name).trim();
  if (!nextStudentNo || !nextFirstName || !nextLastName) {
    return res.status(400).json({ error: 'Student number, first name and last name are required' });
  }
  const link = await resolveProgramLink({ programId: programId !== undefined ? programId : existing.program_id, course: course !== undefined ? course : existing.course });
  if (link.error) return res.status(400).json({ error: link.error });
  if (req.user.role !== 'admin' && (req.user.departmentId || req.user.programId)) {
    if (req.user.programId && Number(link.programId || 0) !== Number(req.user.programId)) {
      return res.status(403).json({ error: 'You can only assign students within your assigned program' });
    }
    if (!req.user.programId && req.user.departmentId && Number(link.departmentId || 0) !== Number(req.user.departmentId)) {
      return res.status(403).json({ error: 'You can only assign students within your assigned department' });
    }
  }
  const nextStatus = status === undefined || status === null || String(status).trim() === ''
    ? (existing.status || 'Active')
    : normalizeStatus(status, existing.status || 'Active');
  try {
    await run(
      `UPDATE students SET student_no = ?, first_name = ?, last_name = ?, email = ?, course = ?, year_level = ?, section = ?, status = ?, program_id = ?, department_id = ?
       WHERE id = ?`,
      [
        nextStudentNo,
        nextFirstName,
        nextLastName,
        email ?? existing.email,
        link.course || null,
        yearLevel ?? existing.year_level,
        section ?? existing.section,
        nextStatus,
        link.programId,
        link.departmentId,
        req.params.id,
      ]
    );
    const row = await getScopedStudent(req.user, req.params.id);
    await logAudit({ user: req.user, action: 'student.update', entity: 'student', entityId: row.id, detail: `${row.studentNo} ${row.lastName}, ${row.firstName}` });
    res.json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that student number already exists' });
    }
    throw err;
  }
});

router.post('/regenerate-qr', requireRole('admin'), async (req, res) => {
  const regenerateAll = req.body?.all === true;
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  if (!regenerateAll && ids.length === 0) return res.status(400).json({ error: 'Provide student ids or set all: true' });
  let targets;
  if (regenerateAll) targets = await all('SELECT id FROM students');
  else {
    if (ids.length > 5000) return res.status(400).json({ error: 'Too many students in one request (max 5000)' });
    const placeholders = ids.map(() => '?').join(',');
    targets = await all(`SELECT id FROM students WHERE id IN (${placeholders})`, ids);
  }
  if (targets.length === 0) return res.status(404).json({ error: 'No matching students found' });
  await batch(targets.map((t) => ({ sql: 'UPDATE students SET qr_token = ? WHERE id = ?', args: [newToken(), t.id] })), 'write');
  await logAudit({ user: req.user, action: 'student.bulk-regenerate-qr', entity: 'student', detail: regenerateAll ? `Regenerated QR for all ${targets.length} student(s)` : `Regenerated QR for ${targets.length} student(s)` });
  res.json({ count: targets.length, ids: targets.map((t) => t.id) });
});

router.post('/:id/portal-reset', requireRole('admin'), async (req, res) => {
  const row = await getScopedStudent(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  await run('UPDATE students SET password_hash = NULL, password_set_at = NULL WHERE id = ?', [row.id]);
  await logAudit({ user: req.user, action: 'student.portal-reset', entity: 'student', entityId: row.id, detail: `${row.studentNo} ${row.lastName}, ${row.firstName} · portal password cleared` });
  res.json({ ok: true });
});

router.post('/:id/regenerate-qr', async (req, res) => {
  const existing = await get('SELECT id, program_id, department_id FROM students WHERE id = ?', [req.params.id]);
  if (!existing || !canManageStudentForUser(req.user, existing)) return res.status(404).json({ error: 'Student not found' });
  await run('UPDATE students SET qr_token = ? WHERE id = ?', [newToken(), req.params.id]);
  const row = await getScopedStudent(req.user, req.params.id);
  await logAudit({ user: req.user, action: 'student.regenerate-qr', entity: 'student', entityId: row.id, detail: `${row.studentNo} ${row.lastName}, ${row.firstName}` });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const student = await getScopedStudent(req.user, req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const info = await run('DELETE FROM students WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Student not found' });
  await logAudit({ user: req.user, action: 'student.delete', entity: 'student', entityId: req.params.id, detail: `${student.studentNo} ${student.lastName}, ${student.firstName}` });
  res.json({ ok: true });
});

export default router;
