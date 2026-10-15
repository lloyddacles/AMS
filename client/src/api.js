const TOKEN_KEY = 'attendance_token';

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

function handleAuthError(status) {
  if (status !== 401) return;
  setToken(null);
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
    if (auth) handleAuthError(res.status);
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  me: () => request('/auth/me'),
  updateProfile: (data) => request('/auth/profile', { method: 'PUT', body: data }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),

  getStudents: (search) => request(`/students${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createStudent: (data) => request('/students', { method: 'POST', body: data }),
  bulkCreateStudents: (students) => request('/students/bulk', { method: 'POST', body: { students } }),
  updateStudent: (id, data) => request(`/students/${id}`, { method: 'PUT', body: data }),
  deleteStudent: (id) => request(`/students/${id}`, { method: 'DELETE' }),
  regenerateStudentQr: (id) => request(`/students/${id}/regenerate-qr`, { method: 'POST' }),

  getEvents: () => request('/events'),
  getEvent: (id) => request(`/events/${id}`),
  createEvent: (data) => request('/events', { method: 'POST', body: data }),
  updateEvent: (id, data) => request(`/events/${id}`, { method: 'PUT', body: data }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),
  regenerateEventCode: (id) => request(`/events/${id}/regenerate-code`, { method: 'POST' }),
  closeEvent: (id) => request(`/events/${id}/close`, { method: 'POST' }),
  reopenEvent: (id) => request(`/events/${id}/reopen`, { method: 'POST' }),

  getEventAttendance: (eventId) => request(`/attendance/event/${eventId}`),
  getTodayAttendance: () => request('/attendance/today'),
  lookupAttendance: (eventId, qrToken) => request('/attendance/lookup', { method: 'POST', body: { eventId, qrToken } }),
  scanAttendance: (eventId, qrToken, status, confirmValue) =>
    request('/attendance/scan', { method: 'POST', body: { eventId, qrToken, status, confirmValue } }),
  manualAttendance: (data) => request('/attendance', { method: 'POST', body: data }),
  updateAttendance: (id, data) => request(`/attendance/${id}`, { method: 'PUT', body: data }),
  deleteAttendance: (id) => request(`/attendance/${id}`, { method: 'DELETE' }),

  getReportOverview: (params) => request(`/reports/overview?${new URLSearchParams(params || {}).toString()}`),
  getReportMatrix: () => request('/reports/matrix'),

  getDashboard: () => request('/dashboard/stats'),

  publicEvent: (code) => request(`/attendance/public/${code}`, { auth: false }),
  publicCheckin: (code, studentNo) => request(`/attendance/public/${code}/checkin`, { method: 'POST', body: { studentNo }, auth: false }),
  publicTodayCheckins: () => request('/attendance/public/today/checkins', { auth: false }),
};

export async function exportCsv(type, eventId) {
  const params = new URLSearchParams({ type });
  if (eventId) params.set('eventId', eventId);
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
