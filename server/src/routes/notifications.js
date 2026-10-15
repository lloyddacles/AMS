import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  runBackgroundChecks,
} from '../services/notifications.js';

const router = Router();
router.use(requireAuth);

// List the current user's notifications (newest first) plus the unread count.
// Also runs the lazy generators so at-risk / low-check-in / daily summaries
// appear without a separate scheduler.
router.get('/', async (req, res) => {
  await runBackgroundChecks();
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const items = await listNotifications(req.user, { limit, unreadOnly });
  const unread = await unreadCount(req.user);
  res.json({ items, unread });
});

router.post('/read-all', async (req, res) => {
  const result = await markAllRead(req.user);
  res.json(result);
});

router.post('/:id/read', async (req, res) => {
  const result = await markRead(req.user, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

export default router;
