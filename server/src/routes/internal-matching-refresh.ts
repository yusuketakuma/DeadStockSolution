import { Router, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { processPendingMatchingRefreshJobs } from '../services/matching-refresh-service';
import { logger } from '../services/logger';

const router = Router();

function resolveCronSecret(): string | null {
  const secret = process.env.MATCHING_REFRESH_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function isAuthorizedCron(reqAuthHeader: string | undefined, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(reqAuthHeader || '', 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

router.get('/retry', async (req, res: Response) => {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret();

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
