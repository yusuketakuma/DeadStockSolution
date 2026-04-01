import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types';
import { adminWriteLimiter } from '../admin-write-limiter';
import { handleAdminError } from '../admin-utils';
import {
  getDdsConnectionStatus,
  issueDdsBootstrapToken,
  rotateDdsControlToken,
} from '../../services/dds-agent-service';

const router = Router();

const bootstrapSchema = z.object({
  adminId: z.number().int().positive().nullable().optional(),
}).strict();

router.get('/openclaw/dds-agent', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getDdsConnectionStatus();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin DDS agent status error', 'DDSエージェント状態の取得に失敗しました', res);
  }
});

router.post('/openclaw/bootstrap-token', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const parsed = bootstrapSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'リクエスト形式が不正です' });
    return;
  }

  try {
    const adminId = parsed.data.adminId ?? req.user?.id ?? null;
    const data = await issueDdsBootstrapToken(adminId);
    res.status(201).json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin DDS bootstrap token issue error', 'DDS bootstrap token の発行に失敗しました', res);
  }
});

router.post('/openclaw/control-token/rotate', adminWriteLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    await rotateDdsControlToken();
    res.json({ message: 'DDS control token をローテーションしました' });
  } catch (err) {
    handleAdminError(err, 'Admin DDS control token rotation error', 'DDS control token のローテーションに失敗しました', res);
  }
});

export default router;
