import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { queueCount } from './store.js';
import { flushQueue } from './sync.js';

const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [lastError, setLastError] = useState('');
  const syncingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await queueCount());
    } catch {
      /* IndexedDB unavailable — treat as nothing queued */
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    if (syncingRef.current) return null;
    syncingRef.current = true;
    setSyncing(true);
    setLastError('');
    try {
      const res = await flushQueue();
      if (res?.total) setLastSyncAt(new Date());
      await refreshPending();
      return res;
    } catch (e) {
      setLastError(e.message || 'Sync failed');
      return null;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPending]);

  useEffect(() => {
    refreshPending();
    const onOnline = () => {
      setOnline(true);
      syncNow();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const iv = setInterval(() => {
      if (navigator.onLine) syncNow();
    }, 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(iv);
    };
  }, [syncNow, refreshPending]);

  const value = { online, pending, syncing, lastSyncAt, lastError, syncNow, refreshPending };
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
