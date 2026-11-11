import { z } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source] ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
      return res.status(400).json({ error: `${path}${issue?.message || 'Invalid request'}` });
    }
    req[source] = parsed.data;
    next();
  };
}

const trimmed = (max = 255) => z.string().trim().max(max);
const optionalTrimmed = (max = 255) => z.preprocess((v) => (v === '' ? undefined : v), trimmed(max).optional());

export const schemas = {
  login: z.object({
    username: trimmed(100).min(1, 'Username and password are required'),
    password: z.string().min(1, 'Username and password are required'),
  }),
  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current and new password are required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters'),
  }),
  studentCreate: z.object({
    studentNo: trimmed(50).min(1, 'Student number, first name and last name are required'),
    firstName: trimmed(100).min(1, 'Student number, first name and last name are required'),
    lastName: trimmed(100).min(1, 'Student number, first name and last name are required'),
    email: optionalTrimmed(200),
    course: optionalTrimmed(120),
    yearLevel: optionalTrimmed(50),
    section: optionalTrimmed(50),
  }),
  studentBulk: z.object({
    updateExisting: z.coerce.boolean().optional().default(false),
    students: z.array(z.record(z.any())).min(1, 'No students to import').max(1000, 'Please import at most 1000 students at a time'),
  }),
  eventCreate: z.object({
    name: trimmed(200).min(1, 'Event name and date are required'),
    description: z.string().trim().max(2000).optional().nullable(),
    location: z.string().trim().max(200).optional().nullable(),
    eventDate: trimmed(30).min(1, 'Event name and date are required'),
    startTime: z.string().trim().max(20).optional().nullable(),
    endTime: z.string().trim().max(20).optional().nullable(),
    status: z.enum(['active', 'closed']).optional(),
    requireStudentConfirm: z.coerce.boolean().optional(),
    autoConfirm: z.coerce.boolean().optional(),
    termId: z.coerce.number().int().positive().optional().nullable(),
  }),
  scan: z.object({
    eventId: z.coerce.number().int().positive(),
    qrToken: z.string().min(1, 'eventId and qrToken are required'),
    confirmValue: z.string().optional().nullable(),
    scannedAt: z.union([z.string(), z.number()]).optional().nullable(),
    clientScanId: z.string().max(100).optional().nullable(),
  }),
  scanLookup: z.object({
    eventId: z.coerce.number().int().positive(),
    qrToken: z.string().min(1, 'eventId and qrToken are required'),
  }),
  scanBatch: z.object({
    scans: z.array(z.record(z.any())).min(0).max(500, 'Too many scans in one batch (max 500)'),
  }),
  manualAttendance: z.object({
    eventId: z.coerce.number().int().positive(),
    studentId: z.coerce.number().int().positive(),
    status: z.enum(['early', 'on-time', 'late', 'present', 'absent', 'excused']).optional().default('present'),
    note: z.string().trim().max(1000).optional().nullable(),
  }),
  attendanceUpdate: z.object({
    status: z.enum(['early', 'on-time', 'late', 'present', 'absent', 'excused']).optional(),
    note: z.string().trim().max(1000).optional().nullable(),
  }),
  correctionLookup: z.object({
    studentNo: trimmed(50).min(1, 'Student number and name are required'),
    name: trimmed(200).min(1, 'Student number and name are required'),
  }),
  correctionCreate: z.object({
    eventId: z.coerce.number().int().positive(),
    studentNo: trimmed(50).min(1),
    name: trimmed(200).min(1),
    requestedStatus: z.enum(['early', 'on-time', 'late', 'present', 'absent', 'excused']),
    reason: trimmed(1000).min(1, 'Please provide a reason'),
  }),
  correctionDecision: z.object({
    note: z.string().trim().max(1000).optional().nullable(),
  }),
};

export function validateIdParam(param = 'id') {
  return (req, res, next) => {
    const n = Number(req.params[param]);
    if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'Invalid id' });
    req.params[param] = String(n);
    next();
  };
}
