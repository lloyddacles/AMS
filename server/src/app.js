import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb, get } from './db.js';
import { ensureAdmin } from './bootstrap.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import eventRoutes from './routes/events.js';
import attendanceRoutes from './routes/attendance.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import userRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import termRoutes from './routes/terms.js';
import scheduleRoutes from './routes/schedules.js';
import correctionRoutes from './routes/corrections.js';
import portalRoutes from './routes/portal.js';
import searchRoutes from './routes/search.js';
import cronRoutes from './routes/cron.js';
import interventionRoutes from './routes/interventions.js';
import { getSettings, refreshSettingsIfStale } from './services/settings.js';
import { securityHeaders, apiRateLimit, authRateLimit, publicWriteRateLimit } from './middleware/security.js';
import { requestId, requestLogger } from './middleware/requestLog.js';

const allowedOrigins = (config.clientOrigin || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
// Correct client IPs and protocol when deployed behind a proxy (Vercel, etc.).
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(requestId);
app.use(requestLogger);
app.use(securityHeaders());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
// Backups can be large; give the admin routes a bigger body limit before the
// global JSON parser (which stays small to guard the public endpoints).
app.use('/api/admin', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '2mb' }));
// Baseline abuse protection for the API surface.
app.use('/api', apiRateLimit());

// Run schema setup + admin seeding once per instance, before handling requests.
let ready = null;
function bootstrap() {
  // Load settings once so the synchronous classification policy cache is warm
  // before the first authenticated request (including on a cold start).
  if (!ready) ready = initDb().then(() => ensureAdmin()).then(() => getSettings());
  return ready;
}
app.use((req, res, next) => {
  bootstrap().then(() => next()).catch(next);
});
// Keep the synchronous classification cache fresh across warm serverless
// instances without adding a query to every scan.
app.use((req, res, next) => {
  refreshSettingsIfStale().then(() => next()).catch(next);
});

app.get('/api/health', async (req, res) => {
  try {
    await get('SELECT 1 AS ok');
    res.json({ ok: true, db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', time: new Date().toISOString() });
  }
});

app.get('/api/ready', async (req, res) => {
  try {
    await get('SELECT 1 AS ok');
    const migration = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").catch(() => null);
    res.json({
      ok: true,
      db: 'up',
      migrations: migration ? 'tracked' : 'legacy',
      env: config.isProduction ? 'production' : 'development',
    });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});
app.use('/api/auth/login', authRateLimit());
app.use('/api/student/login', authRateLimit());
app.use('/api/student/setup', publicWriteRateLimit());
app.use('/api/corrections', publicWriteRateLimit());
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/terms', termRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/corrections', correctionRoutes);
app.use('/api/student', portalRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/interventions', interventionRoutes);

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(JSON.stringify({ level: 'error', msg: 'request_error', requestId: req.id, status, path: req.originalUrl, error: err.message, stack: config.isProduction ? undefined : err.stack }));
  }
  const message =
    status === 413
      ? 'The import is too large. Please split it into smaller files (max ~2 MB).'
      : status >= 500
        ? 'Something went wrong on the server'
        : err.message || 'Request failed';
  res.status(status).json({ error: message, requestId: req.id });
});

export default app;
