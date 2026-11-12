import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate, schemas } from '../validate.js';
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

router.post('/lookup', validate(schemas.correctionLookup), async (req, res) => {
  const { studentNo, name } = req.body;
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

router.post('/', validate(schemas.correctionCreate), async (req, res) => {
  const { eventId, studentNo, name, requestedStatus, reason } = req.body;
  const result = await createRequest({ eventId, studentNo, name, requestedStatus, reason });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.correction);
});

// ---- Staff review queue ----

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status = 'pending', limit = 50, offset = 0 } = req.query;
  res.json(await listRequests({ status, limit: Number(limit) || 50, offset: Number(offset) || 0, user: req.user }));
});

router.post('/:id/approve', validate(schemas.correctionDecision), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  const result = await approveRequest({ id, user: req.user, note: req.body?.note });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.post('/:id/reject', validate(schemas.correctionDecision), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  const result = await rejectRequest({ id, user: req.user, note: req.body?.note });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
