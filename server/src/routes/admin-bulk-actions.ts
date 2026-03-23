import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';
import { adminWriteLimiter } from './admin-write-limiter';
import { parseBulkActionCsv } from '../services/admin-bulk-action-service';
import { executeBulkPharmacyAction, parseBulkPharmacyActionRequest, previewBulkAction } from '../services/admin-bulk-pharmacy-action-service';
import { writeLog, getClientIp } from '../services/log-service';

const router = Router();

router.post('/bulk-actions/parse-csv', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const csvContent = typeof req.body.csvContent === 'string' ? req.body.csvContent : '';
    if (!csvContent.trim()) {
      res.status(400).json({ error: 'CSVデータが空です' });
      return;
    }
    const result = parseBulkActionCsv(csvContent);
    res.json(result);
  } catch (err) {
    handleAdminError(err, 'Admin bulk action CSV parse error', 'CSV解析に失敗しました', res);
  }
});

router.post('/bulk-actions/preview', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBulkPharmacyActionRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const preview = await previewBulkAction(parsed.data.pharmacyIds, parsed.data.action);
    res.json({ preview });
  } catch (err) {
    handleAdminError(err, 'Admin bulk action preview error', 'ドライランに失敗しました', res);
  }
});

router.post('/bulk-actions/execute', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBulkPharmacyActionRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const result = await executeBulkPharmacyAction({
      adminId: req.user!.id,
      action: parsed.data.action,
      pharmacyIds: parsed.data.pharmacyIds,
      reason: parsed.data.reason,
    });

    const logActionMap = {
      verify: 'admin_bulk_verify',
      reject: 'admin_bulk_reject',
      activate: 'admin_bulk_activate',
      deactivate: 'admin_bulk_deactivate',
    } as const;
    void writeLog(logActionMap[parsed.data.action], {
      pharmacyId: req.user!.id,
      detail: `一括操作(${parsed.data.action}): ${parsed.data.pharmacyIds.length}件`,
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    handleAdminError(err, 'Admin bulk action execute error', '一括操作に失敗しました', res);
  }
});

export default router;
