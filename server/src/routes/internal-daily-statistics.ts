import { Router, Response } from 'express';
import { aggregateDailyStatistics } from '../services/daily-statistics-service';
import { logger } from '../services/logger';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';

const router = Router();

router.post('/aggregate', async (req, res: Response) => {
  const startedAt = Date.now();
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('DAILY_STATISTICS_CRON_SECRET');

    if (!secret) {
      logger.error('Daily statistics cron secret is not configured');
      res.status(503).json({ error: 'daily statistics cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const targetDate = typeof req.body?.date === 'string' ? req.body.date : undefined;
    logger.info('Daily statistics cron started', {
      cronName: 'daily_statistics',
      method: req.method,
      targetDate: targetDate ?? null,
    });
    const result = await aggregateDailyStatistics(targetDate);

    logger.info('Daily statistics cron completed', {
      cronName: 'daily_statistics',
      method: req.method,
      targetDate: targetDate ?? null,
      durationMs: Date.now() - startedAt,
      processedCount: result.processedCount,
    });
    res.json({ message: 'ok', processedCount: result.processedCount });
  } catch (err) {
    logger.error('Daily statistics cron aggregate failed', {
      cronName: 'daily_statistics',
      method: req.method,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'daily statistics aggregation failed' });
  }
});

export default router;
