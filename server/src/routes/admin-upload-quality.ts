import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { getUploadQualitySummary, listUploadIssues } from '../services/admin-upload-quality-service';
import { listUploadIssueRemediationHistory, listUploadIssueRemediations, upsertUploadIssueRemediation } from '../services/upload-issue-remediation-service';

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

router.get('/upload-quality/remediations', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await listUploadIssueRemediations();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin upload quality remediations error', '修正ガイドの取得に失敗しました', res);
  }
});

router.put('/upload-quality/remediations/:issueCode', async (req: AuthRequest, res: Response) => {
  try {
    const issueCode = String(req.params.issueCode ?? '').trim();
    const cause = typeof req.body?.cause === 'string' ? req.body.cause.trim() : '';
    const fix = typeof req.body?.fix === 'string' ? req.body.fix.trim() : '';
    const verify = typeof req.body?.verify === 'string' ? req.body.verify.trim() : '';
    if (!issueCode || !cause || !fix || !verify) {
      res.status(400).json({ error: 'issueCode, cause, fix, verify が必要です' });
      return;
    }
    const data = await upsertUploadIssueRemediation({
      issueCode,
      cause,
      fix,
      verify,
      updatedByAdminId: req.user?.id ?? null,
    });
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin upload quality remediation update error', '修正ガイドの更新に失敗しました', res);
  }
});

router.get('/upload-quality/remediations/:issueCode/history', async (req: AuthRequest, res: Response) => {
  try {
    const issueCode = String(req.params.issueCode ?? '').trim();
    if (!issueCode) {
      res.status(400).json({ error: 'issueCode が必要です' });
      return;
    }
    const data = await listUploadIssueRemediationHistory(issueCode);
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin upload quality remediation history error', '修正ガイド履歴の取得に失敗しました', res);
  }
});

export default router;
