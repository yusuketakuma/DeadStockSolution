import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { listUserRequests } from '../services/admin-user-request-service';
import { parsePositiveInt } from '../utils/request-utils';

const router = Router();

router.get('/user-requests', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const pharmacyId = parsePositiveInt(req.query.pharmacyId) ?? undefined;
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

    const { data, total } = await listUserRequests({ page, limit, offset, status, pharmacyId, dateFrom, dateTo });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin user requests list error', 'ユーザーリクエスト一覧の取得に失敗しました', res);
  }
});

export default router;
