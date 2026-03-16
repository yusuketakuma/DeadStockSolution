import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';
import { listAllBusinessHours, listSpecialHours } from '../services/admin-business-hours-service';

const router = Router();

router.get('/business-hours', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await listAllBusinessHours();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin business hours error', '営業時間の取得に失敗しました', res);
  }
});

router.get('/business-hours/special', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await listSpecialHours();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin special hours error', '特別営業時間の取得に失敗しました', res);
  }
});

export default router;
