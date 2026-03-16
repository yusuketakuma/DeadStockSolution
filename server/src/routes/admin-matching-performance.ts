import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';
import { getMatchingPerformance } from '../services/admin-matching-performance-service';

const router = Router();

router.get('/matching-performance', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getMatchingPerformance();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin matching performance error', 'マッチング性能情報の取得に失敗しました', res);
  }
});

export default router;
