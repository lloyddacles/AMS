import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const PAGES = [
  { label: 'Dashboard', to: '/', icon: '▦', keywords: 'home stats overview' },
  { label: 'Live Scan', to: '/live', icon: '◉', keywords: 'monitor command center' },
  { label: 'Students', to: '/students', icon: '◔', keywords: 'directory people' },
  { label: 'Events', to: '/events', icon: '★', keywords: 'attendance activities' },
  { label: 'Schedules', to: '/schedules', icon: '❖', keywords: 'recurring calendar' },
  { label: 'Reports', to: '/reports', icon: '▤', keywords: 'export csv risk trends' },
  { label: 'Corrections', to: '/corrections/review', icon: '✎', keywords: 'requests review appeals' },
  { label: 'Terms', to: '/terms', icon: '▦', keywords: 'semester', roles: ['admin'] },
  { label: 'Settings', to: '/settings', icon: '⚙', keywords: 'policy automation digest', roles: ['admin'] },
  { label: 'Staff', to: '/users', icon: '⚇', keywords: 'users accounts', roles: ['admin'] },
  { label: 'Audit Log', to: '/audit', icon: '☰', keywords: 'history changes', roles: ['admin'] },
  { label: 'Backup', to: '/backup', icon: '⭳', keywords: 'export restore data', roles: ['admin'] },
  { label: 'Profile', to: '/profile', icon: '☺', keywords: 'account password avatar' },
];

function initials(first, last) {
  return `${String(first || '').charAt(0)}${String(last || '').charAt(0)}`.toUpperCase() || '?';
}

function matches(text, query) {
  if (!query) return true;
  const haystack = String(text || '').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setData(null);
    setError('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setData(null);
      setLoading(false);
      setError('');
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const result = await api.search(q);
        setData(result);
        setError('');
      } catch (e) {
        setData(null);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const items = useMemo(() => {
    const q = query.trim();
    const list = [];
    const pageMatches = PAGES.filter(
      (p) => (!p.roles || p.roles.includes(user?.role)) && matches(`${p.label} ${p.keywords}`, q)
    ).slice(0, q ? 4 : 6);
    for (const p of pageMatches) {
      list.push({ key: `page-${p.to}`, group: 'Go to', icon: p.icon, title: p.label, subtitle: p.keywords, to: p.to });
    }
    if (data?.students?.length) {
      for (const s of data.students) {
        list.push({
          key: `student-${s.id}`,
          group: 'Students',
          icon: initials(s.firstName, s.lastName),
          title: `${s.lastName}, ${s.firstName}`,
          subtitle: [s.studentNo, s.course, s.section].filter(Boolean).join(' · '),
          to: `/students?student=${s.id}`,
        });
      }
    }
    if (data?.events?.length) {
      for (const e of data.events) {
        list.push({
          key: `event-${e.id}`,
          group: 'Events',
          icon: '★',
          title: e.name,
          subtitle: [e.eventDate, e.startTime, e.location, Number(e.archived) ? 'Archived' : e.status]
            .filter(Boolean)
            .join(' · '),
          to: `/events/${e.id}`,
        });
      }
    }
    if (data?.schedules?.length) {
      for (const s of data.schedules) {
        list.push({
          key: `schedule-${s.id}`,
          group: 'Schedules',
          icon: '❖',
          title: s.name,
          subtitle: [s.weekdays, s.startTime, s.location].filter(Boolean).join(' · '),
          to: '/schedules',
        });
      }
    }
    if (user?.role === 'admin' && data?.terms?.length) {
      for (const t of data.terms) {
        list.push({
          key: `term-${t.id}`,
          group: 'Terms',
          icon: '▦',
          title: t.name,
          subtitle: `${t.startDate} → ${t.endDate}${Number(t.isCurrent) ? ' · current' : ''}`,
          to: '/terms',
        });
      }
    }
    return list;
  }, [query, data, user?.role]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  function choose(item) {
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    }
  }

  let lastGroup = '';

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input-row">
          <span className="palette-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search students, events, schedules, pages…"
            aria-label="Search"
          />
          <button className="palette-esc" onClick={onClose}>Esc</button>
        </div>

        <div className="palette-list" ref={listRef}>
          {error && <div className="palette-empty">{error}</div>}
          {!error && loading && items.length === 0 && <div className="palette-empty">Searching…</div>}
          {!error && !loading && query.trim().length >= 2 && items.length === 0 && (
            <div className="palette-empty">No matches for “{query.trim()}”.</div>
          )}
          {!error && query.trim().length < 2 && (
            <div className="palette-hint">Jump to a page, or type at least 2 characters to search records.</div>
          )}
          {items.map((item, index) => {
            const group = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {group && <div className="palette-group">{group}</div>}
                <button
                  type="button"
                  data-index={index}
                  className={`palette-item ${index === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className={`palette-icon ${item.group === 'Students' ? 'is-avatar' : ''}`}>{item.icon}</span>
                  <span className="palette-copy">
                    <span className="palette-title">{item.title}</span>
                    {item.subtitle && <span className="palette-subtitle">{item.subtitle}</span>}
                  </span>
                  <span className="palette-enter">↵</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
