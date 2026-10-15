import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
} from '../services/users.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await listUsers());
});

router.post('/', async (req, res) => {
  const { username, password, name, role = 'staff' } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password and name are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!['admin', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const user = await createUser({ username, password, name, role });
    await logAudit({
      user: req.user,
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      detail: `${user.name} (${user.username}) · ${user.role}`,
    });
    res.status(201).json(user);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    throw err;
  }
});

router.put('/:id', async (req, res) => {
  const { name, role, active } = req.body || {};
  const result = await updateUser(req.user.id, req.params.id, { name, role, active });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({
    user: req.user,
    action: 'user.update',
    entity: 'user',
    entityId: result.user.id,
    detail: `${result.user.name} · ${result.user.role} · ${Number(result.user.active) ? 'active' : 'inactive'}`,
  });
  res.json(result.user);
});

router.post('/:id/password', async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const result = await resetUserPassword(req.params.id, password);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({
    user: req.user,
    action: 'user.reset-password',
    entity: 'user',
    entityId: req.params.id,
  });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const result = await deleteUser(req.user.id, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({
    user: req.user,
    action: 'user.delete',
    entity: 'user',
    entityId: req.params.id,
  });
  res.json({ ok: true });
});

export default router;
