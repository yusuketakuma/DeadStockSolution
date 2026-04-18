import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import { createAdminDashboardSnapshot } from '../services/admin-dashboard-snapshot-service';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';

const router = Router();

router.post('/snapshot', async (req: Request, res: Response) => {
  try {
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    const secret = resolveCronSecret('ADMIN_DASHBOARD_SNAPSHOT_CRON_SECRET');

    if (!secret) {
      logger.error('Admin dashboard snapshot cron secret is not configured');
      res.status(503).json({ error: 'admin dashboard snapshot cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await createAdminDashboardSnapshot(since);

    res.json({ ok: true, data: row });
  } catch (err) {
    logger.error('Admin dashboard snapshot cron failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'admin dashboard snapshot failed' });
  }
});

export default router;
