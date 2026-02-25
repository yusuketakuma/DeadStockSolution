import { Router, Response } from 'express';
import { requireLogin } from '../middleware/auth';
import { logger } from '../services/logger';
import { getGitHubUpdates } from '../services/github-updates-service';
import { AuthRequest } from '../types';

const router = Router();

router.use(requireLogin);

router.get('/github', async (_req: AuthRequest, res: Response) => {
  try {
    const updates = await getGitHubUpdates();
    res.json(updates);
  } catch (err) {
    logger.warn('Failed to fetch GitHub updates', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({
      error: 'GitHubのアップデート取得に失敗しました。しばらくしてから再試行してください',
    });
  }
});

export default router;
