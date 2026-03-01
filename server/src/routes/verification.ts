import { Router, Response, Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { handleRouteError } from '../middleware/error-handler';

const router = Router();

router.get('/verification-status', async (req: Request, res: Response) => {
  try {
    const email = req.query.email;
    if (typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'メールアドレスを指定してください' });
      return;
    }

    const [pharmacy] = await db.select({
      verificationStatus: pharmacies.verificationStatus,
      rejectionReason: pharmacies.rejectionReason,
    })
      .from(pharmacies)
      .where(eq(pharmacies.email, email.trim().toLowerCase()))
      .limit(1);

    if (!pharmacy) {
      res.status(404).json({ error: 'アカウントが見つかりません' });
      return;
    }

    res.json({
      verificationStatus: pharmacy.verificationStatus,
      rejectionReason: pharmacy.rejectionReason,
    });
  } catch (error) {
    handleRouteError(error, 'Verification status error', '審査ステータスの取得に失敗しました', res);
  }
});

export default router;
