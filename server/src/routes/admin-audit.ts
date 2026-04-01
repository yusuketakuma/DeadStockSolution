import { Router } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated } from './admin-utils';
import { listAuditLogs } from '../services/admin-audit-service';
import { wrapRoute } from '../middleware/wrap-route';

const router = Router();

router.get('/audit', wrapRoute<AuthRequest>(async (req, res) => {
  const { page, limit, offset } = parseListPagination(req);
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const { data, total } = await listAuditLogs({ page, limit, offset, action });
  sendPaginated(res, data, page, limit, total);
}));

export default router;
