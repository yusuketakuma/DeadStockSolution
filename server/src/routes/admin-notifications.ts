import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { getNotificationStats, listRecentNotifications, listPushSubscriptions } from '../services/admin-notification-service';

const router = Router();

router.get('/notifications/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const stats = await getNotificationStats();
    res.json({ data: stats });
  } catch (err) {
    handleAdminError(err, 'Admin notification stats error', '通知統計の取得に失敗しました', res);
  }
});

router.get('/notifications', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const { data, total } = await listRecentNotifications({ page, limit, offset, type });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin notifications list error', '通知一覧の取得に失敗しました', res);
  }
});

router.get('/notifications/subscriptions', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await listPushSubscriptions();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin push subscriptions error', 'プッシュ購読情報の取得に失敗しました', res);
  }
});

export default router;
