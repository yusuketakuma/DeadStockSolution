import { Router, Request, Response } from 'express';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';
import { archiveExpiredDeadStock } from '../services/dead-stock-archive-service';
import { logger } from '../services/logger';

const router = Router();

async function handleArchiveExpired(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('DEAD_STOCK_ARCHIVE_CRON_SECRET');

    if (!secret) {
      logger.error('Dead stock archive cron secret is not configured');
      res.status(503).json({ error: 'dead stock archive cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const result = await archiveExpiredDeadStock();
    logger.info('Dead stock archive cron completed', result);
    res.json({ message: 'ok', ...result });
  } catch (err) {
    logger.error('Dead stock archive cron failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'dead stock archive failed' });
  }
}

router.post('/archive-expired', handleArchiveExpired);

export default router;
