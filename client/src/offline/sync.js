// Flush the offline scan queue to the server. Safe to call repeatedly: every
// queued scan carries a clientScanId that the server dedupes.

import { api } from '../api.js';
import { listQueue, removeQueued } from './store.js';

// The server caps batches at 500; send in smaller chunks so a long offline
// session still syncs.
const CHUNK = 200;

export async function flushQueue() {
  const queued = await listQueue();
  if (!queued.length) return { synced: 0, total: 0, results: [] };

  // Preserve chronological order so a student's time-in is applied before their
  // time-out, even though IndexedDB returns keys in arbitrary order.
  queued.sort((a, b) => new Date(a.scannedAt || 0) - new Date(b.scannedAt || 0));

  const results = [];
  let synced = 0;

  for (let i = 0; i < queued.length; i += CHUNK) {
    const chunk = queued.slice(i, i + CHUNK);
    const payload = chunk.map((q) => ({
      eventId: q.eventId,
      qrToken: q.qrToken,
      confirmValue: q.confirmValue,
      scannedAt: q.scannedAt,
      clientScanId: q.clientScanId,
    }));

    const res = await api.syncScans(payload);
    synced += res.synced || 0;
    results.push(...(res.results || []));

    // Drop the scans the server accepted (or permanently rejected — retrying a
    // bad token forever would just retry forever, so treat it as final).
    // Network failures throw above and leave the queue intact.
    for (const r of res.results || []) {
      if (r.ok || r.error) await removeQueued(r.clientScanId);
    }
  }

  return { synced, total: queued.length, results };
}
