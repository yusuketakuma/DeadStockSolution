import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types';
import { adminWriteLimiter } from '../admin-write-limiter';
import { parseIdOrBadRequest, handleAdminError } from '../admin-utils';
import {
  listOpenClawCommands,
  getOpenClawCommandById,
  createOpenClawCommand,
  updateOpenClawCommand,
  deleteOpenClawCommand,
} from '../../services/admin-openclaw-command-service';
import { parsePositiveInt } from '../../utils/request-utils';

const router = Router();

const createSchema = z.object({
  commandName: z.string().min(1).max(64),
  category: z.string().min(1).max(16),
  descriptionJa: z.string().max(255).optional(),
  isEnabled: z.boolean().optional(),
  parametersSchema: z.string().optional(),
}).strict();

const updateSchema = z.object({
  commandName: z.string().min(1).max(64).optional(),
  category: z.string().min(1).max(16).optional(),
  descriptionJa: z.string().max(255).nullable().optional(),
  isEnabled: z.boolean().optional(),
  parametersSchema: z.string().nullable().optional(),
}).strict();

router.get('/openclaw-commands', async (req: AuthRequest, res: Response) => {
  try {
    const limit = parsePositiveInt(req.query.limit) ?? undefined;
    const offset = parsePositiveInt(req.query.offset) ?? undefined;
    const data = await listOpenClawCommands({ limit, offset });
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin openclaw commands list error', 'OpenClawコマンド一覧の取得に失敗しました', res);
  }
});

router.get('/openclaw-commands/:id', async (req: AuthRequest, res: Response) => {
  const id = parseIdOrBadRequest(res, req.params.id);
  if (!id) return;
  try {
    const data = await getOpenClawCommandById(id);
    if (!data) { res.status(404).json({ error: 'コマンドが見つかりません' }); return; }
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin openclaw command fetch error', 'OpenClawコマンドの取得に失敗しました', res);
  }
});

router.post('/openclaw-commands', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
    return;
  }
  try {
    const data = await createOpenClawCommand(parsed.data);
    res.status(201).json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin openclaw command create error', 'OpenClawコマンドの登録に失敗しました', res);
  }
});

router.put('/openclaw-commands/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const id = parseIdOrBadRequest(res, req.params.id);
  if (!id) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
    return;
  }
  try {
    const data = await updateOpenClawCommand(id, parsed.data);
    if (!data) { res.status(404).json({ error: 'コマンドが見つかりません' }); return; }
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin openclaw command update error', 'OpenClawコマンドの更新に失敗しました', res);
  }
});

router.delete('/openclaw-commands/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const id = parseIdOrBadRequest(res, req.params.id);
  if (!id) return;
  try {
    const deleted = await deleteOpenClawCommand(id);
    if (!deleted) { res.status(404).json({ error: 'コマンドが見つかりません' }); return; }
    res.json({ message: 'OpenClawコマンドを削除しました' });
  } catch (err) {
    handleAdminError(err, 'Admin openclaw command delete error', 'OpenClawコマンドの削除に失敗しました', res);
  }
});

export default router;
