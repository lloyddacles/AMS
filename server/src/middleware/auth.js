import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get } from '../db.js';
import { getUser } from '../services/users.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

// Student portal sessions are a separate token family: the `type` marker keeps
// them from ever being accepted by staff routes (student ids and user ids are
// independent sequences).
export function signStudentToken(student) {
  return jwt.sign(
    { type: 'student', id: student.id, no: student.student_no },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

// Verify the token, then load the current user so role/active status changes
// take effect immediately (and deactivated accounts are locked out).
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (payload.type === 'student') {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  try {
    const user = await getUser(payload.id);
    if (!user || Number(user.active) === 0) {
      return res.status(401).json({ error: 'Account is inactive or no longer exists' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      mustChangePassword: Number(user.mustChangePassword) ? 1 : 0,
    };

    // An account flagged for a mandatory password change may only call the
    // endpoints needed to complete it.
    if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(pathname(req.originalUrl))) {
      return res.status(403).json({
        error: 'You must change your password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// Endpoints an un-onboarded user is still allowed to reach.
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/password', '/api/auth/me']);

function pathname(url) {
  const path = String(url || '').split('?')[0];
  return path.replace(/\/+$/, '') || path;
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

// Guard for student-portal endpoints. Rejects staff tokens outright so the two
// session families stay separate, and reloads the student row each request.
export async function requireStudentAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (payload.type !== 'student') {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  try {
    const student = await get(
      `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
              email, course, year_level AS yearLevel, section
       FROM students WHERE id = ?`,
      [payload.id]
    );
    if (!student) return res.status(401).json({ error: 'Account no longer exists' });
    req.student = student;
    next();
  } catch (err) {
    next(err);
  }
}
