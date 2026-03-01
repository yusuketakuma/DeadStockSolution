import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import { getMonitoringKpiSnapshot } from '../services/monitoring-kpi-service';
import { isAuthorizedCron } from './internal-cron-auth';
import { parseBoundedInt } from '../utils/number-utils';

const router = Router();

async function handleKpiSnapshot(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const configuredSecret = process.env.MONITORING_CRON_SECRET?.trim();
    const secret = configuredSecret && configuredSecret.length > 0 ? configuredSecret : null;

    if (!secret) {
      logger.error('Monitoring cron secret is not configured');
      res.status(503).json({ error: 'monitoring cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const minutesStr = typeof req.query.minutes === 'string' ? req.query.minutes : undefined;
    const minutes = parseBoundedInt(minutesStr, 60, 5, 24 * 60);

    const snapshot = await getMonitoringKpiSnapshot(minutes);
    res.json(snapshot);
  } catch (err) {
    logger.error('Monitoring KPI snapshot failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'monitoring snapshot failed' });
  }
}

router.get('/kpis', handleKpiSnapshot);
router.post('/kpis', handleKpiSnapshot);

export default router;
