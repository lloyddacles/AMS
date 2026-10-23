const TOKEN_KEY = 'attendance_token';
const STUDENT_TOKEN_KEY = 'student_token';

// In dev, Vite proxies "/api" to the local server. In production, set
// VITE_API_URL to the deployed backend, e.g. https://your-api.onrender.com/api
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getStudentToken() {
  return localStorage.getItem(STUDENT_TOKEN_KEY);
}

export function setStudentToken(token) {
  if (token) localStorage.setItem(STUDENT_TOKEN_KEY, token);
  else localStorage.removeItem(STUDENT_TOKEN_KEY);
}

function handleAuthError(status) {
  if (status !== 401) return;
  setToken(null);
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

// Portal sessions fail soft outside the portal: never bounce a staff user to
// the student login because an old student token expired.
function handleStudentAuthError(status) {
  if (status !== 401) return;
  setStudentToken(null);
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/portal')) {
    window.location.assign('/portal/login');
  }
}

async function request(path, { method = 'GET', body, auth = true, token, student } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const bearer = token !== undefined ? token : auth ? getToken() : null;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // A rejected fetch almost always means the request never left the device.
    const err = new Error('You appear to be offline. Scans will sync automatically once connected.');
    err.network = true;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) {
  if (!res.ok) {
    handleAuthError(res.status);
    throw new Error('Export failed');
  }
    return res.blob();
  }
  const data = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (auth) {
      if (student) handleStudentAuthError(res.status);
      else handleAuthError(res.status);
    }
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

function studentRequest(path, opts = {}) {
  return request(path, { ...opts, token: getStudentToken(), student: true });
}

export const api = {
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  me: () => request('/auth/me'),
  updateProfile: (data) => request('/auth/profile', { method: 'PUT', body: data }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),

  getStudents: (search) => request(`/students${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createStudent: (data) => request('/students', { method: 'POST', body: data }),
  bulkCreateStudents: (students, updateExisting = false) => request('/students/bulk', { method: 'POST', body: { students, updateExisting } }),
  updateStudent: (id, data) => request(`/students/${id}`, { method: 'PUT', body: data }),
  deleteStudent: (id) => request(`/students/${id}`, { method: 'DELETE' }),
  regenerateStudentQr: (id) => request(`/students/${id}/regenerate-qr`, { method: 'POST' }),
  regenerateStudentQrBulk: (payload) => request('/students/regenerate-qr', { method: 'POST', body: payload }),

  getEvents: (termId, opts = {}) => {
    const params = new URLSearchParams();
    if (termId) params.set('termId', termId);
    if (opts.archived !== undefined && opts.archived !== null) params.set('archived', String(opts.archived));
    const qs = params.toString();
    return request(`/events${qs ? `?${qs}` : ''}`);
  },
  getEvent: (id) => request(`/events/${id}`),
  getEventAttendees: (id) => request(`/events/${id}/attendees`),
  setEventAttendees: (id, { studentIds, attending }) =>
    request(`/events/${id}/attendees`, { method: 'POST', body: { studentIds, attending } }),
  setEventAttendeesOnly: (id, studentIds) => request(`/events/${id}/attendees/only`, { method: 'POST', body: { studentIds } }),
  resetEventAttendees: (id) => request(`/events/${id}/attendees/reset`, { method: 'POST' }),
  archiveEvent: (id) => request(`/events/${id}/archive`, { method: 'POST' }),
  unarchiveEvent: (id) => request(`/events/${id}/unarchive`, { method: 'POST' }),
  getSeriesList: () => request('/events/series/list'),
  createSeries: (data) => request('/events/series', { method: 'POST', body: data }),
  getSeries: (id) => request(`/events/series/${id}`),
  addContinuationDay: (eventId, data) => request(`/events/${eventId}/continue`, { method: 'POST', body: data }),
  detachFromSeries: (seriesId, eventId) => request(`/events/series/${seriesId}/detach`, { method: 'POST', body: { eventId } }),
  getScanPack: (id) => request(`/events/${id}/scan-pack`),
  createEvent: (data) => request('/events', { method: 'POST', body: data }),
  updateEvent: (id, data) => request(`/events/${id}`, { method: 'PUT', body: data }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),
  regenerateEventCode: (id) => request(`/events/${id}/regenerate-code`, { method: 'POST' }),
  closeEvent: (id) => request(`/events/${id}/close`, { method: 'POST' }),
  reopenEvent: (id) => request(`/events/${id}/reopen`, { method: 'POST' }),

  getEventAttendance: (eventId) => request(`/attendance/event/${eventId}`),
  getTodayAttendance: () => request('/attendance/today'),
  lookupAttendance: (eventId, qrToken) => request('/attendance/lookup', { method: 'POST', body: { eventId, qrToken } }),
  scanAttendance: (eventId, qrToken, status, confirmValue, opts = {}) =>
    request('/attendance/scan', {
      method: 'POST',
      body: { eventId, qrToken, status, confirmValue, scannedAt: opts.scannedAt, clientScanId: opts.clientScanId },
    }),
  syncScans: (scans) => request('/attendance/scan/batch', { method: 'POST', body: { scans } }),
  manualAttendance: (data) => request('/attendance', { method: 'POST', body: data }),
  updateAttendance: (id, data) => request(`/attendance/${id}`, { method: 'PUT', body: data }),
  deleteAttendance: (id) => request(`/attendance/${id}`, { method: 'DELETE' }),

  getReportOverview: (params) => request(`/reports/overview?${new URLSearchParams(params || {}).toString()}`),
  getReportMatrix: (params) => request(`/reports/matrix?${new URLSearchParams(params || {}).toString()}`),
  getReportTrends: (params) => request(`/reports/trends?${new URLSearchParams(params || {}).toString()}`),
  getAtRisk: (params) => request(`/reports/at-risk?${new URLSearchParams(params || {}).toString()}`),
  getReportCompliance: (params) => request(`/reports/compliance?${new URLSearchParams(params || {}).toString()}`),
  getRisk: () => request('/reports/risk'),
  getStudentRisk: (id) => request(`/reports/risk/${id}`),

  getDashboard: () => request('/dashboard/stats'),

  getTerms: () => request('/terms'),
  createTerm: (data) => request('/terms', { method: 'POST', body: data }),
  updateTerm: (id, data) => request(`/terms/${id}`, { method: 'PUT', body: data }),
  setCurrentTerm: (id) => request(`/terms/${id}/current`, { method: 'POST' }),
  deleteTerm: (id) => request(`/terms/${id}`, { method: 'DELETE' }),

  getSchedules: () => request('/schedules'),
  createSchedule: (data) => request('/schedules', { method: 'POST', body: data }),
  updateSchedule: (id, data) => request(`/schedules/${id}`, { method: 'PUT', body: data }),
  deleteSchedule: (id) => request(`/schedules/${id}`, { method: 'DELETE' }),
  generateSchedule: (id) => request(`/schedules/${id}/generate`, { method: 'POST' }),

  getNotifications: (params) => request(`/notifications?${new URLSearchParams(params || {}).toString()}`),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),

  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: data }),

  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: data }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: data }),
  resetUserPassword: (id, password) => request(`/users/${id}/password`, { method: 'POST', body: { password } }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  getAudit: (params) => request(`/audit?${new URLSearchParams(params || {}).toString()}`),
  getAuditActors: () => request('/audit/actors'),

  getBackupSummary: () => request('/admin/backup/summary'),
  restoreBackup: (backup) => request('/admin/restore', { method: 'POST', body: { backup } }),

  correctionLookup: (studentNo, name) =>
    request('/corrections/lookup', { method: 'POST', body: { studentNo, name }, auth: false }),
  createCorrection: (data) => request('/corrections', { method: 'POST', body: data, auth: false }),
  getCorrections: (status, params = {}) =>
    request(`/corrections?${new URLSearchParams({ status, ...params }).toString()}`),
  approveCorrection: (id, note) => request(`/corrections/${id}/approve`, { method: 'POST', body: { note } }),
  rejectCorrection: (id, note) => request(`/corrections/${id}/reject`, { method: 'POST', body: { note } }),

  publicEvent: (code) => request(`/attendance/public/${code}`, { auth: false }),
  publicCheckin: (code, studentNo) => request(`/attendance/public/${code}/checkin`, { method: 'POST', body: { studentNo }, auth: false }),
  publicTodayCheckins: () => request('/attendance/public/today/checkins', { auth: false }),

  studentSetup: (data) => request('/student/setup', { method: 'POST', body: data, auth: false }),
  studentLogin: (data) => request('/student/login', { method: 'POST', body: data, auth: false }),
  studentMe: () => studentRequest('/student/me'),
  studentDashboard: () => studentRequest('/student/dashboard'),
  studentAttendance: (params = {}) => studentRequest(`/student/attendance?${new URLSearchParams(params).toString()}`),
  studentTerms: () => studentRequest('/student/terms'),
  studentCorrections: (params = {}) => studentRequest(`/student/corrections?${new URLSearchParams(params).toString()}`),
  studentCreateCorrection: (data) => studentRequest('/student/corrections', { method: 'POST', body: data }),
  studentChangePassword: (currentPassword, newPassword) =>
    studentRequest('/student/password', { method: 'POST', body: { currentPassword, newPassword } }),
  resetStudentPortal: (id) => request(`/students/${id}/portal-reset`, { method: 'POST' }),
};

export async function exportCsv(type, eventId, extra = {}) {  const params = new URLSearchParams({ type });
  if (eventId) params.set('eventId', eventId);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const token = getToken();
  const res = await fetch(`${API_BASE}/reports/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'export.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadBackup() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/admin/backup`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Could not download the backup');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'attendx-backup.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
