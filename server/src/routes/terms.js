import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const selectFields = `t.id, t.name, t.start_date AS startDate, t.end_date AS endDate,
  t.is_current AS isCurrent, t.created_at AS createdAt,
  (SELECT COUNT(*) FROM events e WHERE e.term_id = t.id) AS eventCount,
  (SELECT COUNT(*) FROM schedules s WHERE s.term_id = t.id) AS scheduleCount`;

function getTerm(id) {
  return get(`SELECT ${selectFields} FROM terms t WHERE t.id = ?`, [id]);
}

function validate(body, existing) {
  const name = String(body.name ?? existing?.name ?? '').trim();
  const startDate = String(body.startDate ?? existing?.startDate ?? '').trim();
  const endDate = String(body.endDate ?? existing?.endDate ?? '').trim();
  if (!name || !startDate || !endDate) return { error: 'Term name, start date and end date are required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: 'Dates must be in YYYY-MM-DD format' };
  }
  if (endDate < startDate) return { error: 'End date must be on or after the start date' };
  return { name, startDate, endDate };
}

router.get('/', async (req, res) => {
  const rows = await all(`SELECT ${selectFields} FROM terms t ORDER BY t.start_date DESC, t.id DESC`);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await getTerm(req.params.id);
  if (!row) return res.status(404).json({ error: 'Term not found' });
  res.json(row);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const parsed = validate(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const isCurrent = req.body?.isCurrent ? 1 : 0;
  const info = await run(
    'INSERT INTO terms (name, start_date, end_date, is_current) VALUES (?, ?, ?, ?)',
    [parsed.name, parsed.startDate, parsed.endDate, isCurrent]
  );
  if (isCurrent) {
    await run('UPDATE terms SET is_current = 0 WHERE id != ?', [info.lastInsertRowid]);
  }
  const created = await getTerm(info.lastInsertRowid);
  await logAudit({
    user: req.user,
    action: 'term.create',
    entity: 'term',
    entityId: created.id,
    detail: `${created.name} (${created.startDate} → ${created.endDate})`,
  });
  res.status(201).json(created);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const existing = await getTerm(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Term not found' });
  const parsed = validate(req.body || {}, existing);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  await run('UPDATE terms SET name = ?, start_date = ?, end_date = ? WHERE id = ?', [
    parsed.name,
    parsed.startDate,
    parsed.endDate,
    req.params.id,
  ]);
  if (req.body?.isCurrent) {
    await run('UPDATE terms SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END', [req.params.id]);
  }
  const updated = await getTerm(req.params.id);
  await logAudit({
    user: req.user,
    action: 'term.update',
    entity: 'term',
    entityId: updated.id,
    detail: `${updated.name} (${updated.startDate} → ${updated.endDate})`,
  });
  res.json(updated);
});

router.post('/:id/current', requireRole('admin'), async (req, res) => {
  const existing = await getTerm(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Term not found' });
  await run('UPDATE terms SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END', [req.params.id]);
  const updated = await getTerm(req.params.id);
  await logAudit({
    user: req.user,
    action: 'term.set-current',
    entity: 'term',
    entityId: updated.id,
    detail: updated.name,
  });
  res.json(updated);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const term = await getTerm(req.params.id);
  const info = await run('DELETE FROM terms WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Term not found' });
  await logAudit({
    user: req.user,
    action: 'term.delete',
    entity: 'term',
    entityId: req.params.id,
    detail: term?.name || null,
  });
  res.json({ ok: true });
});

export default router;
