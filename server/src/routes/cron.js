import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { runAutomation } from '../services/automation.js';

const router = Router();

function matches(candidate) {
  if (!candidate || !config.cronSecret) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.cronSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Vercel Cron sends GET requests with `Authorization: Bearer <CRON_SECRET>`.
// POST is supported for manual runs and other schedulers.
function authorized(req) {
  if (!config.cronSecret) return !config.isProduction;
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return matches(bearer) || matches(String(req.query.secret || ''));
}

async function handle(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!config.cronSecret && config.isProduction) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured on this deployment' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const result = await runAutomation();
  res.json(result);
}

router.get('/', handle);
router.post('/', handle);

export default router;
