import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const POLL_MS = 30000;

function parseUtc(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function timeAgo(value) {
  const d = parseUtc(value);
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getNotifications({ limit: 30 });
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch {
      // Offline or transient error: keep the last known state.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await load();
      setLoading(false);
    }
  }

  async function handleItem(item) {
    if (!item.isRead) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
      api.markNotificationRead(item.id).catch(() => {});
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    api.markAllNotificationsRead().catch(() => {});
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className={`notif-bell ${open ? 'open' : ''}`}
        onClick={toggle}
        aria-label="Notifications"
        title="Notifications"
      >
        <svg
          className="notif-bell-icon"
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={handleMarkAll}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-list">
            {loading && !items.length ? (
              <div className="notif-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="notif-empty">You're all caught up.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  className={`notif-item sev-${n.severity} ${n.isRead ? 'is-read' : ''}`}
                  onClick={() => handleItem(n)}
                >
                  <div className="notif-item-top">
                    <span className="notif-item-title">{n.title}</span>
                    <span className="notif-item-time">{timeAgo(n.createdAt)}</span>
                  </div>
                  {n.body && <div className="notif-item-body">{n.body}</div>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
