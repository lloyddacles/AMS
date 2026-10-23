import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, run } from '../db.js';
import { signStudentToken, requireStudentAuth } from '../middleware/auth.js';
import { findStudent, createForStudent, listForStudent } from '../services/corrections.js';
import { dashboardFor, historyFor, listTerms } from '../services/portal.js';
import { checkLogin, recordFailure, recordSuccess } from '../services/loginGuard.js';
import { logAudit } from '../services/audit.js';
import { DEFAULT_PASSWORD } from '../services/users.js';
import { config } from '../config.js';

const router = Router();

const MIN_PASSWORD = 6;

// Both identity shapes reach this file: raw rows from findStudent (setup) and
// the aliased session row from requireStudentAuth.
function publicStudent(s) {
  return {
    id: s.id,
    studentNo: s.student_no ?? s.studentNo,
    firstName: s.first_name ?? s.firstName,
    lastName: s.last_name ?? s.lastName,
    email: s.email ?? null,
    course: s.course ?? null,
    yearLevel: s.year_level ?? s.yearLevel,
    section: s.section ?? null,
  };
}

function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function lockResponse(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({
    error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    retryAfter,
  });
}

// ---- First-time setup: student number + full name verify identity, then the
// student claims a password. Throttled per student number like staff sign-in,
// so the name gate can't be brute-forced. ----
router.post('/setup', async (req, res) => {
  const { studentNo, name, password } = req.body || {};
  const no = String(studentNo || '').trim();
  if (!no || !password) {
    return res.status(400).json({ error: 'Student number and password are required' });
  }
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }
  if (String(password).toLowerCase() === DEFAULT_PASSWORD) {
    return res.status(400).json({ error: 'Please choose a password other than the default' });
  }

  const key = `student-setup:${no}`;
  const gate = await checkLogin(key);
  if (gate.locked) return lockResponse(res, gate.retryAfter);

  const found = await findStudent({ studentNo: no, name });
  if (found.error) {
    if (name) {
      const status = await recordFailure(key);
      if (status.locked) return lockResponse(res, status.retryAfter);
    }
    return res.status(found.status).json({ error: found.error });
  }
  const student = found.student;
  if (student.password_hash) {
    return res.status(409).json({ error: 'This account is already set up. Please sign in instead.' });
  }

  await run('UPDATE students SET password_hash = ?, password_set_at = ? WHERE id = ?', [
    bcrypt.hashSync(String(password), 10),
    nowUtc(),
    student.id,
  ]);
  await recordSuccess(key);
  await logAudit({
    user: { name: `${student.first_name} ${student.last_name} (${student.student_no})` },
    action: 'student.setup',
    entity: 'student',
    entityId: student.id,
    detail: 'Portal account created',
  });
  res.json({ token: signStudentToken(student), student: publicStudent(student) });
});

// ---- Sign in ----
router.post('/login', async (req, res) => {
  const { studentNo, password } = req.body || {};
  const no = String(studentNo || '').trim();
  if (!no || !password) {
    return res.status(400).json({ error: 'Student number and password are required' });
  }

  const key = `student:${no}`;
  const gate = await checkLogin(key);
  if (gate.locked) return lockResponse(res, gate.retryAfter);

  const student = await get('SELECT * FROM students WHERE student_no = ?', [no]);
  if (!student) {
    const status = await recordFailure(key);
    if (status.locked) return lockResponse(res, status.retryAfter);
    return res.status(401).json({ error: 'Invalid student number or password' });
  }
  if (!student.password_hash) {
    return res.status(403).json({
      error: 'Your account has no password yet. Choose "Set up account" first.',
      code: 'SETUP_REQUIRED',
    });
  }

  let ok = false;
  try {
    ok = bcrypt.compareSync(String(password), student.password_hash);
  } catch {
    ok = false;
  }
  if (!ok) {
    const status = await recordFailure(key);
    if (status.locked) return lockResponse(res, status.retryAfter);
    return res.status(401).json({ error: 'Invalid student number or password' });
  }

  await recordSuccess(key);
  res.json({ token: signStudentToken(student), student: publicStudent(student) });
});

// ---- Authenticated portal ----

router.use(requireStudentAuth);

router.get('/me', (req, res) => {
  res.json({ student: req.student });
});

router.get('/dashboard', async (req, res) => {
  res.json(await dashboardFor(req.student.id));
});

router.get('/attendance', async (req, res) => {
  const { limit, offset, termId, from, to, q } = req.query;
  res.json(
    await historyFor(req.student.id, {
      limit,
      offset,
      termId: termId || null,
      from: from || '',
      to: to || '',
      q: q || '',
    })
  );
});

router.get('/terms', async (req, res) => {
  res.json(await listTerms());
});

router.get('/corrections', async (req, res) => {
  const { status = 'all', limit = 50, offset = 0 } = req.query;
  res.json(
    await listForStudent({
      studentId: req.student.id,
      status,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    })
  );
});

router.post('/corrections', async (req, res) => {
  const { eventId, requestedStatus, reason } = req.body || {};
  const result = await createForStudent({
    student: req.student,
    eventId,
    requestedStatus,
    reason,
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.correction);
});

router.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` });
  }
  if (String(newPassword).toLowerCase() === DEFAULT_PASSWORD) {
    return res.status(400).json({ error: 'Please choose a password other than the default' });
  }

  const student = await get('SELECT * FROM students WHERE id = ?', [req.student.id]);
  if (!student || !student.password_hash) {
    return res.status(400).json({ error: 'No password is set for this account' });
  }
  let ok = false;
  try {
    ok = bcrypt.compareSync(String(currentPassword), student.password_hash);
  } catch {
    ok = false;
  }
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

  await run('UPDATE students SET password_hash = ?, password_set_at = ? WHERE id = ?', [
    bcrypt.hashSync(String(newPassword), 10),
    nowUtc(),
    student.id,
  ]);
  await logAudit({
    user: { name: `${student.first_name} ${student.last_name} (${student.student_no})` },
    action: 'student.password-change',
    entity: 'student',
    entityId: student.id,
    detail: 'Portal password changed',
  });
  res.json({ ok: true });
});

export default router;
