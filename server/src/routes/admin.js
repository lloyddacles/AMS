import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { exportData, importData, backupSummary } from '../services/backup.js';
import { runAutomation } from '../services/automation.js';
import { runDigestNow } from '../services/digest.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Current row counts per table (shown on the Backup page).
router.get('/backup/summary', async (req, res) => {
  res.json(await backupSummary());
});

// Download the entire database as a JSON file.
router.get('/backup', async (req, res) => {
  const data = await exportData();
  await logAudit({
    user: req.user,
    action: 'admin.backup',
    entity: 'system',
    detail: 'Downloaded a full data backup',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="attendx-backup-${stamp}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

// Run lifecycle maintenance immediately (auto-close, auto-archive, alerts).
// The same job runs on the daily Vercel cron and lazily on page loads.
router.post('/automation/run', async (req, res) => {
  const result = await runAutomation();
  res.json(result);
});

// Send the attendance digest immediately, regardless of the saved schedule.
// Useful for checking recipients and the notification layout.
router.post('/digest/run', async (req, res) => {
  const result = await runDigestNow();
  await logAudit({
    user: req.user,
    action: 'digest.run',
    entity: 'system',
    detail: `Manual digest ${result.digest?.from || ''}–${result.digest?.to || ''}`,
  });
  res.json(result);
});

// Replace all data with the contents of a previously downloaded backup.
router.post('/restore', async (req, res) => {
  const payload = req.body?.backup ?? req.body;
  const result = await importData(payload);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  await logAudit({
    user: req.user,
    action: 'admin.restore',
    entity: 'system',
    detail: `Restored data: ${JSON.stringify(result.counts)}`,
  });
  res.json(result);
});

export default router;
