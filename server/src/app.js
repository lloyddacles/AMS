import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb } from './db.js';
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

const allowedOrigins = (config.clientOrigin || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
// Backups can be large; give the admin routes a bigger body limit before the
// global JSON parser (which stays small to guard the public endpoints).
app.use('/api/admin', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '2mb' }));

// Run schema setup + admin seeding once per instance, before handling requests.
let ready = null;
function bootstrap() {
  if (!ready) ready = initDb().then(() => ensureAdmin());
  return ready;
}
app.use((req, res, next) => {
  bootstrap().then(() => next()).catch(next);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
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
app.use('/api/admin', adminRoutes);

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message =
    status === 413
      ? 'The import is too large. Please split it into smaller files (max ~2 MB).'
      : status >= 500
        ? 'Something went wrong on the server'
        : err.message || 'Request failed';
  res.status(status).json({ error: message });
});

export default app;
