import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { validate, schemas, validateIdParam } from '../validate.js';
import { listBlocs, getBloc, createBloc, updateBloc, deleteBloc, listBlocMembers, addBlocMembers, removeBlocMembers, setBlocMembers } from '../services/blocs.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const includeInactive = req.user?.role === 'admin' ? String(req.query.includeInactive || '') === '1' : false;
  const rows = await listBlocs(req.user, { search: req.query.search || '', includeInactive });
  res.json(rows);
});

router.get('/:id', validateIdParam('id'), async (req, res) => {
  const bloc = await getBloc(req.params.id, req.user);
  if (!bloc) return res.status(404).json({ error: 'Bloc not found' });
  res.json(bloc);
});

router.post('/', validate(schemas.blocCreate), async (req, res) => {
  const result = await createBloc(req.body || {}, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  await logAudit({ user: req.user, action: 'bloc.create', entity: 'bloc', entityId: result.bloc.id, detail: result.bloc.name });
  res.status(201).json(result.bloc);
});

router.put('/:id', validateIdParam('id'), validate(schemas.blocUpdate), async (req, res) => {
  const result = await updateBloc(req.params.id, req.body || {}, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  await logAudit({ user: req.user, action: 'bloc.update', entity: 'bloc', entityId: result.bloc.id, detail: result.bloc.name });
  res.json(result.bloc);
});

router.delete('/:id', validateIdParam('id'), async (req, res) => {
  const result = await deleteBloc(req.params.id, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  await logAudit({ user: req.user, action: 'bloc.delete', entity: 'bloc', entityId: result.bloc.id, detail: result.bloc.name });
  res.json({ ok: true });
});

router.get('/:id/members', validateIdParam('id'), async (req, res) => {
  const result = await listBlocMembers(req.params.id, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

router.post('/:id/members', validateIdParam('id'), validate(schemas.blocMembers), async (req, res) => {
  const result = await addBlocMembers(req.params.id, req.body.studentIds, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  await logAudit({ user: req.user, action: 'bloc.members.add', entity: 'bloc', entityId: result.bloc.id, detail: `${result.bloc.name} · +${result.added}${result.rejectedCount ? `, ${result.rejectedCount} skipped` : ''}` });
  res.json(result);
});

router.post('/:id/members/remove', validateIdParam('id'), validate(schemas.blocMembers), async (req, res) => {
  const result = await removeBlocMembers(req.params.id, req.body.studentIds, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  await logAudit({ user: req.user, action: 'bloc.members.remove', entity: 'bloc', entityId: result.bloc.id, detail: `${result.bloc.name} · -${result.removed}` });
  res.json(result);
});

router.put('/:id/members', validateIdParam('id'), async (req, res) => {
  const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
  const result = await setBlocMembers(req.params.id, studentIds, req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  await logAudit({ user: req.user, action: 'bloc.members.set', entity: 'bloc', entityId: result.bloc.id, detail: `${result.bloc.name} · members=${result.members.length}` });
  res.json(result);
});

export default router;
