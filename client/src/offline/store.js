// Offline persistence for the scanner: cached scan packs, the pending-scan
// queue, local attendance state (so time-in vs time-out works offline), and a
// cached copy of today's check-ins.

import { idbGet, idbAll, idbPut, idbDelete, idbCount } from './idb.js';

export function newClientScanId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- Scan packs ----
export async function savePack(pack) {
  if (!pack?.event?.id) return;
  await idbPut('packs', { ...pack, eventId: pack.event.id, cachedAt: new Date().toISOString() });
}

export function getPack(eventId) {
  return idbGet('packs', Number(eventId));
}

// ---- Pending-scan queue ----
export function enqueueScan(scan) {
  return idbPut('queue', scan);
}

export function listQueue() {
  return idbAll('queue');
}

export function removeQueued(clientScanId) {
  return idbDelete('queue', clientScanId);
}

export function queueCount() {
  return idbCount('queue');
}

// ---- Local attendance state per event (studentId -> { in, out }) ----
function stateKey(eventId) {
  return `state:${eventId}`;
}

export async function getLocalState(eventId) {
  const row = await idbGet('local', stateKey(eventId));
  return row?.map || {};
}

export async function saveLocalState(eventId, map) {
  await idbPut('local', { key: stateKey(eventId), map });
}

// Seed the local map from authoritative server attendance, preserving any
// offline-only entries already recorded on this device.
export async function seedLocalState(eventId, attendance = []) {
  const map = await getLocalState(eventId);
  for (const a of attendance) {
    if (a?.studentId == null) continue;
    map[String(a.studentId)] = {
      in: a.checkedInAt || null,
      out: a.checkedOutAt || null,
      status: a.status || null,
    };
  }
  await saveLocalState(eventId, map);
  return map;
}

// ---- Cached "today" list (shown when offline) ----
export function getTodayCache() {
  return idbGet('local', 'today');
}

export async function setTodayCache(records) {
  await idbPut('local', { key: 'today', records, cachedAt: new Date().toISOString() });
}
