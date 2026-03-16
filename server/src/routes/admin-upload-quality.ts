import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { getUploadQualitySummary, listUploadIssues } from '../services/admin-upload-quality-service';

const router = Router();

router.get('/upload-quality/summary', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getUploadQualitySummary();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin upload quality summary error', 'アップロード品質サマリーの取得に失敗しました', res);
  }
});

router.get('/upload-quality/issues', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const issueCode = typeof req.query.issueCode === 'string' ? req.query.issueCode : undefined;
    const { data, total } = await listUploadIssues({ page, limit, offset, issueCode });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin upload quality issues error', 'アップロード問題一覧の取得に失敗しました', res);
  }
});

export default router;
