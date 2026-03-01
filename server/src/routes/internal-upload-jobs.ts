import { Router, Request, Response } from 'express';
import {
  cleanupUploadConfirmJobs,
  processPendingUploadConfirmJobs,
} from '../services/upload-confirm-job-service';
import { logger } from '../services/logger';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';
import { parseBoundedInt } from '../utils/number-utils';

const router = Router();
const DEFAULT_PROCESS_LIMIT = 1;
const DEFAULT_CLEANUP_LIMIT = 50;

async function handleRetry(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('UPLOAD_JOBS_CRON_SECRET');

    if (!secret) {
      logger.error('Upload jobs cron secret is not configured');
      res.status(503).json({ error: 'upload jobs cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const limitStr = typeof req.query.limit === 'string' ? req.query.limit : undefined;
    const cleanupStr = typeof req.query.cleanupLimit === 'string' ? req.query.cleanupLimit : undefined;
    // Enforce strict sequential processing: exactly one job per cron tick.
    const processLimit = parseBoundedInt(limitStr, DEFAULT_PROCESS_LIMIT, 1, 1);
    const cleanupLimit = parseBoundedInt(cleanupStr, DEFAULT_CLEANUP_LIMIT, 1, 500);
    const processed = await processPendingUploadConfirmJobs(processLimit);
    const cleaned = await cleanupUploadConfirmJobs(cleanupLimit);
    logger.info('Upload jobs cron retry completed', {
      processed,
      cleaned,
      processLimit,
      cleanupLimit,
      method: req.method,
    });
    res.json({ message: 'ok', processed, cleaned });
  } catch (err) {
    logger.error('Upload jobs cron retry failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'upload jobs retry failed' });
  }
}

router.get('/retry', handleRetry);
router.post('/retry', handleRetry);

export default router;
