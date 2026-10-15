import { Router } from 'express';
import { verifyCredentials, changePassword, getUser, updateProfile, DEFAULT_PASSWORD } from '../services/users.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { checkLogin, recordFailure, recordSuccess } from '../services/loginGuard.js';
import { config } from '../config.js';

const router = Router();

// Max size for a stored avatar data URL (~1MB of base64 text).
const AVATAR_MAX_LEN = 1000000;
const AVATAR_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const gate = await checkLogin(username);
  if (gate.locked) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return res.status(429).json({
      error: `Too many failed sign-in attempts. Try again in ${Math.ceil(gate.retryAfter / 60)} minute(s).`,
      retryAfter: gate.retryAfter,
    });
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    const status = await recordFailure(username);
    if (status.locked) {
      res.setHeader('Retry-After', String(status.retryAfter));
      return res.status(429).json({
        error: `Too many failed sign-in attempts. This account is locked for ${config.loginLockMinutes} minute(s).`,
        retryAfter: status.retryAfter,
      });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  await recordSuccess(username);
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

router.put('/profile', requireAuth, async (req, res) => {
  const { name, avatar } = req.body || {};
  if (avatar !== undefined && avatar !== null && avatar !== '') {
    if (typeof avatar !== 'string' || !AVATAR_RE.test(avatar)) {
      return res.status(400).json({ error: 'Profile picture must be a PNG, JPG, WEBP, or GIF image' });
    }
    if (avatar.length > AVATAR_MAX_LEN) {
      return res.status(413).json({ error: 'Profile picture is too large. Please use a smaller image.' });
    }
  }
  const result = await updateProfile(req.user.id, { name, avatar: avatar === '' ? null : avatar });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ user: result.user });
});

router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (String(newPassword).toLowerCase() === DEFAULT_PASSWORD) {
    return res.status(400).json({ error: 'Please choose a password other than the default' });
  }
  const result = await changePassword(req.user.id, currentPassword, newPassword);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, user: await getUser(req.user.id) });
});

export default router;
