import { Router, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../services/logger';
import { triggerManualMonthlyReport } from '../services/monthly-report-scheduler';
import { resolveDefaultTargetMonth, validateYearMonth } from '../services/monthly-report-service';

const router = Router();

function resolveCronSecret(): string | null {
  const secret = process.env.MONTHLY_REPORT_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
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

router.get('/run', async (req, res: Response) => {
  try {
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    const secret = resolveCronSecret();

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
    const year = Number(req.query.year ?? defaultTarget.year);
    const month = Number(req.query.month ?? defaultTarget.month);
    validateYearMonth(year, month);

    await triggerManualMonthlyReport(year, month);
    res.json({ message: 'ok', year, month });
  } catch (err) {
    if (err instanceof Error && err.message.includes('不正')) {
      res.status(400).json({ error: err.message });
      return;
    }

    logger.error('Monthly report cron run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'monthly report run failed' });
  }
});

export default router;
