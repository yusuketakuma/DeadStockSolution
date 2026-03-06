import { Router, Response } from 'express';
import { logger } from '../services/logger';
import { triggerManualMonthlyReport } from '../services/monthly-report-scheduler';
import { resolveDefaultTargetMonth, validateYearMonth } from '../services/monthly-report-service';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';
import { parsePositiveInt } from '../utils/request-utils';

const router = Router();

router.get('/run', async (req, res: Response) => {
  try {
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    const secret = resolveCronSecret('MONTHLY_REPORT_CRON_SECRET');

    if (!secret) {
      logger.error('Monthly report cron secret is not configured');
      res.status(503).json({ error: 'monthly report cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const defaultTarget = resolveDefaultTargetMonth();
    const yearRaw = req.query.year !== undefined
      ? parsePositiveInt(req.query.year)
      : defaultTarget.year;
    const monthRaw = req.query.month !== undefined
      ? parsePositiveInt(req.query.month)
      : defaultTarget.month;

    // Validate year is 4 digits in reasonable range (2020-2099)
    if (yearRaw === null || yearRaw < 2020 || yearRaw > 2099) {
      res.status(400).json({ error: '年パラメータが不正です' });
      return;
    }

    // Validate month is 1-12
    if (monthRaw === null || monthRaw < 1 || monthRaw > 12) {
      res.status(400).json({ error: '月パラメータが不正です' });
      return;
    }

    const year = yearRaw;
    const month = monthRaw;
    validateYearMonth(year, month);

    await triggerManualMonthlyReport(year, month);
    res.json({ message: 'ok', year, month });
  } catch (err) {
    if (err instanceof Error && err.message.includes('不正')) {
      res.status(400).json({ error: '年月パラメータが不正です' });
      return;
    }

    logger.error('Monthly report cron run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'monthly report run failed' });
  }
});

export default router;
