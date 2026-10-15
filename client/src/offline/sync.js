// Flush the offline scan queue to the server. Safe to call repeatedly: every
// queued scan carries a clientScanId that the server dedupes.

import { api } from '../api.js';
import { listQueue, removeQueued } from './store.js';

export async function flushQueue() {
  const queued = await listQueue();
  if (!queued.length) return { synced: 0, total: 0, results: [] };

  // Preserve chronological order so a student's time-in is applied before their
  // time-out, even though IndexedDB returns keys in arbitrary order.
  queued.sort((a, b) => new Date(a.scannedAt || 0) - new Date(b.scannedAt || 0));

  const payload = queued.map((q) => ({
    eventId: q.eventId,
    qrToken: q.qrToken,
    confirmValue: q.confirmValue,
    scannedAt: q.scannedAt,
    clientScanId: q.clientScanId,
  }));

  const res = await api.syncScans(payload);

  // Drop the scans the server accepted (or permanently rejected — retrying a
  // bad token forever would just retry forever, so treat 4xx-style errors as
  // final). Network failures throw above and leave the queue intact.
  for (const r of res.results || []) {
    if (r.ok || r.error) await removeQueued(r.clientScanId);
  }

  return res;
}
