import { Router } from 'express';
import { verifyCredentials, changePassword, getUser, updateProfile } from '../services/users.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// Max size for a stored avatar data URL (~1MB of base64 text).
const AVATAR_MAX_LEN = 1000000;
const AVATAR_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = await verifyCredentials(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
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
  const result = await changePassword(req.user.id, currentPassword, newPassword);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

export default router;
