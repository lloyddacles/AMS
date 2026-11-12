import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { SCHEDULE_FIELDS, getSchedule, generateScheduleEvents, weekdayLabel } from '../services/schedules.js';
import { scheduleScopeFilter, scopedWriteScope } from '../services/academic.js';

const router = Router();
router.use(requireAuth);

function normalizeWeekdays(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const days = [...new Set(list.map((n) => Number(String(n).trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  return days.sort((a, b) => a - b);
}

async function resolveDates(body, existing) {
  let startDate = body.startDate ?? existing?.startDate ?? '';
  let endDate = body.endDate ?? existing?.endDate ?? '';
  const termId = body.termId !== undefined ? body.termId : existing?.termId ?? null;
  if (termId && (!startDate || !endDate)) {
    const term = await get('SELECT start_date, end_date FROM terms WHERE id = ?', [termId]);
    if (term) {
      if (!startDate) startDate = term.start_date;
      if (!endDate) endDate = term.end_date;
    }
  }
  return { termId: termId || null, startDate: String(startDate).trim(), endDate: String(endDate).trim() };
}

async function validate(body, existing, req) {
  const name = String(body.name ?? existing?.name ?? '').trim();
  const { termId, startDate, endDate } = await resolveDates(body, existing);
  const weekdays = normalizeWeekdays(body.weekdays ?? existing?.weekdayList ?? existing?.weekdays ?? '');
  if (!name) return { error: 'Schedule name is required' };
  if (!weekdays.length) return { error: 'Pick at least one weekday' };
  if (!startDate || !endDate) return { error: 'Start and end dates are required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: 'Dates must be in YYYY-MM-DD format' };
  }
  if (endDate < startDate) return { error: 'End date must be on or after the start date' };

  const requestedScope = req.user?.role === 'admin'
    ? { departmentId: body.departmentId !== undefined ? body.departmentId : existing?.departmentId, programId: body.programId !== undefined ? body.programId : existing?.programId }
    : { departmentId: existing?.departmentId, programId: existing?.programId };
  const scope = scopedWriteScope(req.user, requestedScope);

  return {
    name,
    termId,
    startDate,
    endDate,
    weekdays: weekdays.join(','),
    description: body.description ?? existing?.description ?? null,
    location: body.location ?? existing?.location ?? null,
    startTime: body.startTime ?? existing?.startTime ?? null,
    endTime: body.endTime ?? existing?.endTime ?? null,
    requireStudentConfirm:
      body.requireStudentConfirm === undefined
        ? Number(existing?.requireStudentConfirm || 0)
        : body.requireStudentConfirm ? 1 : 0,
    active: body.active === undefined ? Number(existing?.active ?? 1) : body.active ? 1 : 0,
    departmentId: scope.departmentId,
    programId: scope.programId,
  };
}

function getScopedSchedule(id, user) {
  const scope = scheduleScopeFilter(user, { scheduleAlias: 's' });
  return get(
    `SELECT ${SCHEDULE_FIELDS}
     FROM schedules s
     LEFT JOIN terms t ON t.id = s.term_id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN programs p ON p.id = s.program_id
     WHERE s.id = ? ${scope.where}`,
    [id, ...scope.params]
  ).then((row) => {
    if (!row) return row;
    const label = weekdayLabel(String(row.weekdays || '').split(',').map(Number));
    return { ...row, active: Number(row.active) ? 1 : 0, weekdayLabel: label, weekdayList: String(row.weekdays || '').split(',').map(Number).filter((n) => Number.isInteger(n)) };
  });
}

router.get('/', async (req, res) => {
  const scope = scheduleScopeFilter(req.user, { scheduleAlias: 's' });
  const where = scope.where ? `WHERE 1=1 ${scope.where}` : '';
  const rows = await all(
    `SELECT ${SCHEDULE_FIELDS}
     FROM schedules s
     LEFT JOIN terms t ON t.id = s.term_id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN programs p ON p.id = s.program_id
     ${where}
     ORDER BY s.created_at DESC, s.id DESC`,
    scope.params
  );
  res.json(rows.map((r) => {
    const label = weekdayLabel(String(r.weekdays || '').split(',').map(Number));
    return { ...r, active: Number(r.active) ? 1 : 0, weekdayLabel: label };
  }));
});

router.get('/:id', async (req, res) => {
  const row = await getScopedSchedule(req.params.id, req.user);
  if (!row) return res.status(404).json({ error: 'Schedule not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const parsed = await validate(req.body || {}, null, req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const info = await run(
    `INSERT INTO schedules (term_id, name, description, location, weekdays, start_time, end_time, start_date, end_date, require_student_confirm, active, department_id, program_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsed.termId,
      parsed.name,
      parsed.description,
      parsed.location,
      parsed.weekdays,
      parsed.startTime,
      parsed.endTime,
      parsed.startDate,
      parsed.endDate,
      parsed.requireStudentConfirm,
      parsed.active,
      parsed.departmentId,
      parsed.programId,
    ]
  );
  const created = await getSchedule(info.lastInsertRowid);
  await logAudit({
    user: req.user,
    action: 'schedule.create',
    entity: 'schedule',
    entityId: created.id,
    detail: `${created.name} · ${created.weekdayLabel} · ${created.startDate} → ${created.endDate}`,
  });
  res.status(201).json(created);
});

router.put('/:id', async (req, res) => {
  const existing = await getScopedSchedule(req.params.id, req.user);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  const parsed = await validate(req.body || {}, existing, req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  await run(
    `UPDATE schedules SET term_id = ?, name = ?, description = ?, location = ?, weekdays = ?,
      start_time = ?, end_time = ?, start_date = ?, end_date = ?, require_student_confirm = ?, active = ?, department_id = ?, program_id = ?
     WHERE id = ?`,
    [
      parsed.termId,
      parsed.name,
      parsed.description,
      parsed.location,
      parsed.weekdays,
      parsed.startTime,
      parsed.endTime,
      parsed.startDate,
      parsed.endDate,
      parsed.requireStudentConfirm,
      parsed.active,
      parsed.departmentId,
      parsed.programId,
      req.params.id,
    ]
  );
  const updated = await getSchedule(req.params.id);
  await logAudit({
    user: req.user,
    action: 'schedule.update',
    entity: 'schedule',
    entityId: updated.id,
    detail: `${updated.name} · ${updated.weekdayLabel} · ${updated.startDate} → ${updated.endDate}`,
  });
  res.json(updated);
});

// Generate (or top up) the recurring event instances for this schedule.
router.post('/:id/generate', async (req, res) => {
  const existing = await getScopedSchedule(req.params.id, req.user);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  const result = await generateScheduleEvents(req.params.id);
  const updated = await getSchedule(req.params.id);
  await logAudit({
    user: req.user,
    action: 'schedule.generate',
    entity: 'schedule',
    entityId: updated.id,
    detail: `${updated.name} · created ${result.created}, skipped ${result.skipped}`,
  });
  res.json({ ...result, schedule: updated });
});

router.delete('/:id', async (req, res) => {
  const schedule = await getScopedSchedule(req.params.id, req.user);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  await run('UPDATE events SET schedule_id = NULL WHERE schedule_id = ?', [req.params.id]);
  await run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
  await logAudit({
    user: req.user,
    action: 'schedule.delete',
    entity: 'schedule',
    entityId: req.params.id,
    detail: schedule?.name || null,
  });
  res.json({ ok: true });
});

export default router;
