import { Router } from 'express';
import type { AuthRequest } from '../types';
import { parseListPagination, sendPaginated } from './admin-utils';
import { adminWriteLimiter } from './admin-write-limiter';
import { listAlerts, bulkResolveAlerts, getAlertTrends } from '../services/admin-alert-service';
import { wrapRoute } from '../middleware/wrap-route';

const router = Router();

router.get('/alerts', wrapRoute<AuthRequest>(async (req, res) => {
  const { page, limit, offset } = parseListPagination(req);
  const alertType = typeof req.query.alertType === 'string' ? req.query.alertType : undefined;
  const resolved = typeof req.query.resolved === 'string' ? req.query.resolved as 'true' | 'false' : undefined;
  const { data, total } = await listAlerts({ page, limit, offset, alertType, resolved });
  sendPaginated(res, data, page, limit, total);
}));

router.post('/alerts/bulk-resolve', adminWriteLimiter, wrapRoute<AuthRequest>(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id: unknown) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    res.status(400).json({ error: 'アラートIDの配列を指定してください' });
    return;
  }
  if (ids.length > 100) {
    res.status(400).json({ error: '一括解決は最大100件までです' });
    return;
  }
  const resolved = await bulkResolveAlerts(ids);
  res.json({ message: `${resolved}件のアラートを解決しました`, resolvedCount: resolved });
}));

router.get('/alerts/trends', wrapRoute<AuthRequest>(async (_req, res) => {
  const trends = await getAlertTrends();
  res.json({ data: trends });
}));

export default router;
