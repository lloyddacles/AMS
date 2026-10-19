import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  findStudent,
  recordsFor,
  createRequest,
  listRequests,
  approveRequest,
  rejectRequest,
} from '../services/corrections.js';

const router = Router();

// ---- Public: students identify themselves with student number + full name ----
// No account needed — nothing changes until a staff member approves a request.

router.post('/lookup', async (req, res) => {
  const { studentNo, name } = req.body || {};
  const found = await findStudent({ studentNo, name });
  if (found.error) return res.status(found.status).json({ error: found.error });
  const records = await recordsFor(found.student.id);
  res.json({
    student: {
      id: found.student.id,
      studentNo: found.student.student_no,
      firstName: found.student.first_name,
      lastName: found.student.last_name,
      course: found.student.course,
      yearLevel: found.student.year_level,
      section: found.student.section,
    },
    records,
  });
});

router.post('/', async (req, res) => {
  const { eventId, studentNo, name, requestedStatus, reason } = req.body || {};
  const result = await createRequest({ eventId, studentNo, name, requestedStatus, reason });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.correction);
});

// ---- Staff review queue ----

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status = 'pending', limit = 50, offset = 0 } = req.query;
  res.json(await listRequests({ status, limit: Number(limit) || 50, offset: Number(offset) || 0 }));
});

router.post('/:id/approve', async (req, res) => {
  const result = await approveRequest({ id: Number(req.params.id), user: req.user, note: req.body?.note });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.post('/:id/reject', async (req, res) => {
  const result = await rejectRequest({ id: Number(req.params.id), user: req.user, note: req.body?.note });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
