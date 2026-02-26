import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthRequest } from '../types';
import { listTrustScores, triggerTrustScoreRecalculation } from '../services/trust-score-service';
import { handleAdminError, parseListPagination, sendPaginated } from './admin-utils';

const router = Router();

const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '管理系APIへのリクエストが多すぎます。しばらくして再試行してください' },
});

router.get('/pharmacies/trust', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req);
    const result = await listTrustScores(page, limit);
    sendPaginated(res, result.data, page, limit, result.total);
  } catch (err) {
    handleAdminError(err, 'Admin trust score list error', '信頼スコア一覧の取得に失敗しました', res);
  }
});

router.post('/pharmacies/trust/recalculate', adminWriteLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    const result = triggerTrustScoreRecalculation();
    res.status(202).json({
      message: result.started ? '信頼スコア再計算を開始しました' : '信頼スコア再計算は既に実行中です',
      started: result.started,
      startedAt: result.startedAt,
    });
  } catch (err) {
    handleAdminError(err, 'Admin trust score recalc error', '信頼スコアの再計算に失敗しました', res);
  }
});

export default router;
