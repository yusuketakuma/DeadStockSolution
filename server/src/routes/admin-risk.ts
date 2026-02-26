import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { getAdminPharmacyRiskPage, getAdminRiskOverview } from '../services/expiry-risk-service';
import { handleAdminError, parseListPagination, sendPaginated } from './admin-utils';

const router = Router();

router.get('/risk/overview', async (_req: AuthRequest, res: Response) => {
  try {
    const overview = await getAdminRiskOverview();
    res.json(overview);
  } catch (err) {
    handleAdminError(err, 'Admin risk overview error', 'リスク概要の取得に失敗しました', res);
  }
});

router.get('/risk/pharmacies', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req);
    const result = await getAdminPharmacyRiskPage(page, limit);
    sendPaginated(res, result.data, page, limit, result.total);
  } catch (err) {
    handleAdminError(err, 'Admin risk pharmacies error', '薬局別リスクの取得に失敗しました', res);
  }
});

export default router;
