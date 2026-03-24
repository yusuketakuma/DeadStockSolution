import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  getOpenClawRetryQueueSnapshot,
  processPendingOpenClawRetries,
} from '../services/openclaw-retry-service';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';
import { parseBoundedInt } from '../utils/number-utils';

const router = Router();

async function handleRun(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('OPENCLAW_RETRIES_CRON_SECRET');

    if (!secret) {
      logger.error('OpenClaw retries cron secret is not configured');
      res.status(503).json({ error: 'openclaw retries cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const limitStr = typeof req.query.limit === 'string' ? req.query.limit : undefined;
    const limit = parseBoundedInt(limitStr, 20, 1, 100);
    const result = await processPendingOpenClawRetries(limit);
    const stats = await getOpenClawRetryQueueSnapshot();

    res.json({
      message: 'ok',
      ...result,
      stats,
    });
  } catch (err) {
    logger.error('OpenClaw retries cron run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'openclaw retries run failed' });
  }
}

router.get('/run', handleRun);
router.post('/run', handleRun);

export default router;
