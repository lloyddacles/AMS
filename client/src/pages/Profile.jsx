import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const MAX_DIM = 320;

// Load a File into a resized square-ish JPEG data URL so avatars stay small.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_DIM / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPG, WEBP, or GIF).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('That image is too large. Please choose one under 8 MB.');
      return;
    }
    try {
      setAvatar(await resizeImage(file));
    } catch (err) {
      setError(err.message);
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { user: updated } = await api.updateProfile({ name, avatar: avatar || '' });
      updateUser(updated);
      setNotice('Profile saved');
      setTimeout(() => setNotice(''), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function removePhoto() {
    setAvatar(null);
  }

  const initial = (name || user?.username || 'A')[0]?.toUpperCase() || 'A';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Profile</h2>
          <p className="muted">Manage your administrator account and profile picture.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <div className="card profile-card">
        <form className="profile-form" onSubmit={save}>
          <div className="profile-avatar">
            {avatar ? (
              <img className="avatar-lg" src={avatar} alt="Profile" />
            ) : (
              <span className="avatar-lg avatar-lg-empty">{initial}</span>
            )}
            <div className="profile-avatar-actions">
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                {avatar ? 'Change picture' : 'Upload picture'}
              </button>
              {avatar && (
                <button type="button" className="btn btn-sm btn-danger" onClick={removePhoto}>
                  Remove
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={pickFile}
                hidden
              />
            </div>
            <p className="muted small center">Recommended: a square image. Large photos are resized automatically.</p>
          </div>

          <div className="profile-fields">
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
            </label>
            <div className="form-grid-2">
              <label>
                Username
                <input value={user?.username || ''} disabled />
              </label>
              <label>
                Role
                <input value={user?.role || ''} disabled />
              </label>
            </div>
            <div className="profile-actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
