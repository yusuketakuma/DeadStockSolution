import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';
import { adminWriteLimiter } from './admin-write-limiter';
import { parseBulkActionCsv } from '../services/admin-bulk-action-service';

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

export default router;
