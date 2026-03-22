import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';
import { getBreaches, clearBreaches, getBreachCount } from '../services/slo-tracking-service';

const router = Router();

/**
 * GET /api/admin/slo-breaches
 *
 * 最近の SLO 違反一覧を返す。
 * クエリパラメータ:
 *   limit — 取得件数 (1–200, default: 50)
 */
router.get('/slo-breaches', (req: AuthRequest, res: Response) => {
  try {
    const rawLimit = req.query['limit'];
    const limit = rawLimit !== undefined ? parseInt(String(rawLimit), 10) : 50;

    if (isNaN(limit) || limit < 1 || limit > 200) {
      res.status(400).json({ error: 'limit は 1 以上 200 以下の整数で指定してください' });
      return;
    }

    const data = getBreaches(limit);
    const total = getBreachCount();

    res.json({ data, total });
  } catch (err) {
    handleAdminError(err, 'Admin SLO breaches fetch error', 'SLO 違反履歴の取得に失敗しました', res);
  }
});

/**
 * DELETE /api/admin/slo-breaches
 *
 * SLO 違反履歴を全消去する（管理者専用メンテナンス操作）。
 */
router.delete('/slo-breaches', (_req: AuthRequest, res: Response) => {
  try {
    clearBreaches();
    res.json({ ok: true });
  } catch (err) {
    handleAdminError(err, 'Admin SLO breaches clear error', 'SLO 違反履歴の消去に失敗しました', res);
  }
});

export default router;
