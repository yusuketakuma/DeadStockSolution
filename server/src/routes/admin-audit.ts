import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { listAuditLogs } from '../services/admin-audit-service';

const router = Router();

router.get('/audit', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const { data, total } = await listAuditLogs({ page, limit, offset, action });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin audit list error', '監査ログの取得に失敗しました', res);
  }
});

export default router;
