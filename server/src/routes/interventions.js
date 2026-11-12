import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listFlaggedForIntervention,
  listInterventions,
  createIntervention,
  buildSummaryDraft,
  CAUSE_CATEGORIES,
} from '../services/interventions.js';

const router = Router();
router.use(requireAuth);

router.get('/flagged', async (req, res) => {
  const { search = '', course = '' } = req.query;
  res.json(await listFlaggedForIntervention({ search, course }));
});

router.get('/causes', (req, res) => {
  res.json({ causeCategories: CAUSE_CATEGORIES });
});

router.get('/student/:studentId', async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!Number.isInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'Invalid student id' });
  const data = await listInterventions(studentId);
  if (!data) return res.status(404).json({ error: 'Student not found' });
  res.json(data);
});

router.post('/student/:studentId/summary', async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!Number.isInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'Invalid student id' });
  const draft = await buildSummaryDraft(studentId, req.body || {});
  if (!draft) return res.status(404).json({ error: 'Student not found' });
  res.json(draft);
});

router.post('/', async (req, res) => {
  const studentId = Number(req.body?.studentId);
  if (!Number.isInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'studentId is required' });
  const result = await createIntervention({ ...req.body, studentId }, req.user);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(201).json(result);
});

export default router;