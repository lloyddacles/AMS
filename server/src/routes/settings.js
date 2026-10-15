import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await getSettings());
});

router.put('/', requireRole('admin'), async (req, res) => {
  const result = await updateSettings(req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const changes = Object.entries(req.body || {})
    .map(([k, v]) => `${k} → ${v}`)
    .join('; ');
  await logAudit({
    user: req.user,
    action: 'setting.update',
    entity: 'setting',
    entityId: null,
    detail: changes,
  });
  res.json(result.settings);
});

export default router;
