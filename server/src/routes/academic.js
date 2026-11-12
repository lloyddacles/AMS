import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getAcademicStructure,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createProgram,
  updateProgram,
  deleteProgram,
} from '../services/academic.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

// Available to staff/admin for forms/filters (scoped UIs can use it).
// Admin can request includeInactivePrograms=1 for management.
router.get('/structure', async (req, res) => {
  const includeInactivePrograms = req.user?.role === 'admin' && String(req.query.includeInactivePrograms || '') === '1';
  res.json(await getAcademicStructure({ includeInactivePrograms }));
});

router.post('/departments', requireRole('admin'), async (req, res) => {
  const result = await createDepartment(req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({ user: req.user, action: 'department.create', entity: 'department', entityId: result.department.id, detail: result.department.name });
  res.status(201).json(result.department);
});

router.put('/departments/:id', requireRole('admin'), async (req, res) => {
  const result = await updateDepartment(req.params.id, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({ user: req.user, action: 'department.update', entity: 'department', entityId: result.department.id, detail: result.department.name });
  res.json(result.department);
});

router.delete('/departments/:id', requireRole('admin'), async (req, res) => {
  const result = await deleteDepartment(req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({ user: req.user, action: 'department.delete', entity: 'department', entityId: result.department.id, detail: result.department.name });
  res.json({ ok: true });
});

router.post('/programs', requireRole('admin'), async (req, res) => {
  const { departmentId, name, code } = req.body || {};
  const result = await createProgram({ departmentId, name, code });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({
    user: req.user,
    action: 'program.create',
    entity: 'program',
    entityId: result.program.id,
    detail: `${result.program.name} · ${result.program.departmentName}`,
  });
  res.status(201).json(result.program);
});

router.put('/programs/:id', requireRole('admin'), async (req, res) => {
  const result = await updateProgram(req.params.id, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({
    user: req.user,
    action: 'program.update',
    entity: 'program',
    entityId: result.program.id,
    detail: `${result.program.name} · ${result.program.departmentName}`,
  });
  res.json(result.program);
});

router.delete('/programs/:id', requireRole('admin'), async (req, res) => {
  const result = await deleteProgram(req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({ user: req.user, action: 'program.delete', entity: 'program', entityId: result.program.id, detail: result.program.name });
  res.json({ ok: true });
});

export default router;
