import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { listRelationships } from '../services/admin-relationship-service';
import { parsePositiveInt } from '../utils/request-utils';

const router = Router();

router.get('/relationships', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const relationshipType = typeof req.query.type === 'string' ? req.query.type : undefined;
    const pharmacyId = parsePositiveInt(req.query.pharmacyId) ?? undefined;
    const { data, total } = await listRelationships({ page, limit, offset, relationshipType, pharmacyId });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin relationships list error', '関係性一覧の取得に失敗しました', res);
  }
});

export default router;
