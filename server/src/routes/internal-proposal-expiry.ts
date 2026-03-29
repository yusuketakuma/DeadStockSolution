import { Router, Request, Response } from 'express';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';
import { expireStaleProposals, sendExpiryReminders } from '../services/exchange-execution-service';
import { logger } from '../services/logger';

const router = Router();

async function handleExpireStale(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('PROPOSAL_EXPIRY_CRON_SECRET');

    if (!secret) {
      logger.error('Proposal expiry cron secret is not configured');
      res.status(503).json({ error: 'proposal expiry cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const reminderResult = await sendExpiryReminders();
    const expireResult = await expireStaleProposals();
    const result = { ...reminderResult, ...expireResult };
    logger.info('Proposal expiry cron completed', result);
    res.json({ message: 'ok', ...result });
  } catch (err) {
    logger.error('Proposal expiry cron failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'proposal expiry failed' });
  }
}

router.post('/expire-stale', handleExpireStale);

export default router;
