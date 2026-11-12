import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getAcademicStructure, createProgram } from '../services/academic.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

// Available to staff/admin for forms/filters (scoped UIs can use it).
router.get('/structure', async (req, res) => {
  res.json(await getAcademicStructure());
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

export default router;
