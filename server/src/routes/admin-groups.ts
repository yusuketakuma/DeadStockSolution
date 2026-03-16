import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, parseIdOrBadRequest, handleAdminError } from './admin-utils';
import { adminWriteLimiter } from './admin-write-limiter';
import { listGroups, getGroupMembers, removeGroupMember } from '../services/admin-group-service';
import { parsePositiveInt } from '../utils/request-utils';

const router = Router();

router.get('/groups', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const visibility = typeof req.query.visibility === 'string' ? req.query.visibility : undefined;
    const { data, total } = await listGroups({ page, limit, offset, visibility });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin groups list error', 'グループ一覧の取得に失敗しました', res);
  }
});

router.get('/groups/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const members = await getGroupMembers(id);
    res.json({ data: members });
  } catch (err) {
    handleAdminError(err, 'Admin group members error', 'グループメンバーの取得に失敗しました', res);
  }
});

router.post('/groups/:groupId/remove-member', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseIdOrBadRequest(res, req.params.groupId);
    if (!groupId) return;
    const pharmacyId = parsePositiveInt(String(req.body.pharmacyId));
    if (!pharmacyId) {
      res.status(400).json({ error: '薬局IDが不正です' });
      return;
    }
    const removed = await removeGroupMember(groupId, pharmacyId);
    if (!removed) {
      res.status(404).json({ error: 'メンバーが見つかりません' });
      return;
    }
    res.json({ message: 'メンバーを除外しました' });
  } catch (err) {
    handleAdminError(err, 'Admin group remove member error', 'メンバー除外に失敗しました', res);
  }
});

export default router;
