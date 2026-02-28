import { Router, Response } from 'express';
import { processPendingMatchingRefreshJobs } from '../services/matching-refresh-service';
import { logger } from '../services/logger';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';

const router = Router();

router.get('/retry', async (req, res: Response) => {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('MATCHING_REFRESH_CRON_SECRET');

    if (!secret) {
      logger.error('Matching refresh cron secret is not configured');
      res.status(503).json({ error: 'matching refresh cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const processed = await processPendingMatchingRefreshJobs(20);
    res.json({ message: 'ok', processed });
  } catch (err) {
    logger.error('Matching refresh cron retry failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'matching refresh retry failed' });
  }
});

export default router;
