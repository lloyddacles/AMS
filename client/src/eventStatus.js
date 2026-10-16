// Lifecycle phase of an event for display. The server computes an authoritative
// `phase` (timezone-correct) and sends it on every event payload; `phaseOf`
// falls back to a best-effort local computation for older payloads.

export const EVENT_PHASES = {
  active: { label: 'Active', pill: 'pill-green' },
  upcoming: { label: 'Coming Soon', pill: 'pill-blue' },
  closed: { label: 'Closed', pill: 'pill-gray' },
};

export function phaseOf(event) {
  if (!event) return 'active';
  if (event.phase && EVENT_PHASES[event.phase]) return event.phase;
  if (event.status && event.status !== 'active') return 'closed';
  const date = event.eventDate;
  if (!date) return 'active';
  const start = new Date(`${date}T${event.startTime || '00:00'}:00`);
  if (!Number.isNaN(start.getTime()) && start.getTime() > Date.now()) return 'upcoming';
  return 'active';
}
