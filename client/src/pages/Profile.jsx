import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import PageHeader from '../components/PageHeader.jsx';

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
    <div className="page profile-page">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        subtitle="Manage your account details and profile picture."
      />

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <section className="card profile-hero">
        <div className="profile-hero-main">
          <div className="profile-avatar-wrap">
            {avatar ? (
              <img className="avatar-lg profile-avatar-img" src={avatar} alt="Profile" />
            ) : (
              <span className="avatar-lg avatar-lg-empty profile-avatar-img">{initial}</span>
            )}
            <button
              type="button"
              className="profile-avatar-fab"
              onClick={() => fileRef.current?.click()}
              title={avatar ? 'Change picture' : 'Upload picture'}
            >
              ✎
            </button>
          </div>
          <div className="profile-hero-copy">
            <div className="profile-name-row">
              <h2>{name || user?.name || 'Your profile'}</h2>
              <span className="pill pill-blue">{user?.role || 'staff'}</span>
            </div>
            <p className="muted">@{user?.username || 'account'} · Keep your profile up to date for a personalized experience.</p>
            <div className="profile-quick-meta">
              <div className="profile-meta-chip">
                <span>Username</span>
                <strong>@{user?.username || '—'}</strong>
              </div>
              <div className="profile-meta-chip">
                <span>Role</span>
                <strong>{user?.role || '—'}</strong>
              </div>
              <div className="profile-meta-chip">
                <span>Photo</span>
                <strong>{avatar ? 'Custom' : 'Default'}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="profile-grid">
        <section className="card profile-panel">
          <div className="profile-panel-head">
            <h3>Profile picture</h3>
            <p className="muted small">Upload a clear image so your account is easy to recognize.</p>
          </div>
          <div className="profile-avatar-panel">
            <div className="profile-avatar-preview">
              {avatar ? (
                <img className="profile-avatar-lg" src={avatar} alt="Profile preview" />
              ) : (
                <span className="profile-avatar-lg profile-avatar-placeholder">{initial}</span>
              )}
            </div>
            <div className="profile-avatar-actions modern">
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                {avatar ? 'Change picture' : 'Upload picture'}
              </button>
              {avatar && (
                <button type="button" className="btn" onClick={removePhoto}>
                  Remove photo
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
            <p className="muted small">Recommended: square image (PNG/JPG/WEBP/GIF). Large photos are resized automatically (up to 8 MB).</p>
          </div>
        </section>

        <section className="card profile-panel">
          <div className="profile-panel-head">
            <h3>Account details</h3>
            <p className="muted small">Update your display name. Username and role are managed by the system.</p>
          </div>
          <form className="profile-form-modern" onSubmit={save}>
            <label className="profile-field">
              <span>Display name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
              <small className="muted">This name appears across the app.</small>
            </label>

            <div className="profile-form-grid">
              <label className="profile-field">
                <span>Username</span>
                <input value={user?.username || ''} disabled />
              </label>
              <label className="profile-field">
                <span>Role</span>
                <input value={user?.role || ''} disabled />
              </label>
            </div>

            <div className="profile-actions modern">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? 'Saving changes…' : 'Save changes'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
