import { Router, Request, Response } from 'express';
import { runPredictiveAlertsJob } from '../services/predictive-alert-service';
import { logger } from '../services/logger';
import { isAuthorizedCron } from './internal-cron-auth';
import { parseBoundedInt } from '../utils/number-utils';

const router = Router();
const DEFAULT_NEAR_EXPIRY_DAYS = 45;
const DEFAULT_EXCESS_STOCK_MONTHS = 3;

async function handleRun(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const configuredSecret = process.env.PREDICTIVE_ALERTS_CRON_SECRET?.trim();
    const secret = configuredSecret && configuredSecret.length > 0 ? configuredSecret : null;

    if (!secret) {
      logger.error('Predictive alerts cron secret is not configured');
      res.status(503).json({ error: 'predictive alerts cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const nearExpiryDaysRaw = typeof req.query.nearExpiryDays === 'string' ? req.query.nearExpiryDays : undefined;
    const excessStockMonthsRaw = typeof req.query.excessStockMonths === 'string' ? req.query.excessStockMonths : undefined;

    const nearExpiryDays = parseBoundedInt(nearExpiryDaysRaw, DEFAULT_NEAR_EXPIRY_DAYS, 1, 180);
    const excessStockMonths = parseBoundedInt(excessStockMonthsRaw, DEFAULT_EXCESS_STOCK_MONTHS, 1, 12);

    const result = await runPredictiveAlertsJob({
      nearExpiryDays,
      excessStockMonths,
    });

    logger.info('Predictive alerts job completed', {
      nearExpiryDays,
      excessStockMonths,
      ...result,
      method: req.method,
    });

    res.json({ message: 'ok', ...result });
  } catch (err) {
    logger.error('Predictive alerts run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'predictive alerts run failed' });
  }
}

router.get('/run', handleRun);
router.post('/run', handleRun);

export default router;
