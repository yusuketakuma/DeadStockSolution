import { Router, Response, Request } from 'express';
import { handleRouteError } from '../middleware/error-handler';

const router = Router();

/**
 * メール列挙攻撃を防止するため、常に同一レスポンスを返す。
 * 実際の審査ステータスはメール通知またはログイン試行で確認する。
 */
router.get('/verification-status', async (req: Request, res: Response) => {
  try {
    const email = req.query.email;
    if (typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'メールアドレスを指定してください' });
      return;
    }

    // Anti-enumeration: 未登録/審査中/承認済み/却下 すべて同一レスポンス
    res.json({
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    });
  } catch (error) {
    handleRouteError(error, 'Verification status error', '審査ステータスの取得に失敗しました', res);
  }
});

export default router;
