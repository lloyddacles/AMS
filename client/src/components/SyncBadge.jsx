import { useOffline } from '../offline/OfflineProvider.jsx';

export default function SyncBadge() {
  const { online, pending, syncing, syncNow } = useOffline();
  if (online && pending === 0 && !syncing) return null;
  return (
    <div className={`sync-badge ${online ? 'is-online' : 'is-offline'}`}>
      <span className="sync-dot" />
      <span className="sync-text">
        {!online ? 'Offline' : syncing ? 'Syncing…' : 'Online'}
        {pending > 0 ? ` · ${pending} queued` : ''}
      </span>
      {online && pending > 0 && !syncing && (
        <button className="sync-now" onClick={syncNow}>
          Sync now
        </button>
      )}
    </div>
  );
}
