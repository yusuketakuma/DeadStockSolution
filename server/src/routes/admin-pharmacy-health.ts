import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';
import { getPharmacyHealthSummary } from '../services/admin-pharmacy-health-service';

const router = Router();

router.get('/pharmacy-health', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getPharmacyHealthSummary();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy health error', '薬局ヘルス情報の取得に失敗しました', res);
  }
});

export default router;
