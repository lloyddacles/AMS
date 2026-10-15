import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listAudit, listAuditActors } from '../services/audit.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', async (req, res) => {
  const { userId, entity, action, search, from, to, limit = 50, offset = 0 } = req.query;
  const result = await listAudit({
    userId: userId || undefined,
    entity: entity || undefined,
    action: action || undefined,
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  });
  res.json(result);
});

router.get('/actors', async (req, res) => {
  res.json(await listAuditActors());
});

export default router;
