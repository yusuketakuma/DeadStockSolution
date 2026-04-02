import { Router, Request, Response } from 'express';
import { isAuthorizedCron, resolveCronSecret } from './internal-cron-auth';
import { triggerManualAutoSync } from '../services/drug-master/scheduler';
import { triggerManualPackageAutoSync } from '../services/drug-package-scheduler';
import { logger } from '../services/logger';

const router = Router();

/**
 * 薬価マスター自動同期 cron エンドポイント
 *
 * POST /api/internal/drug-master-sync/run
 *
 * MHLW ポータルと MEDIS 包装単位データの更新をチェックし、
 * 変更があればDBを更新する。
 */
async function handleDrugMasterSync(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  try {
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
    const secret = resolveCronSecret('DRUG_MASTER_SYNC_CRON_SECRET');

    if (!secret) {
      logger.error('Drug master sync cron secret is not configured');
      res.status(503).json({ error: 'drug master sync cron is not configured' });
      return;
    }

    if (!isAuthorizedCron(authHeader, secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    logger.info('Drug master sync cron started', {
      cronName: 'drug_master_sync',
      method: req.method,
    });

    // Phase 1: MHLW 薬価基準データ同期
    const drugResult = await triggerManualAutoSync();

    // Phase 2: MEDIS 包装単位データ同期
    const packageResult = await triggerManualPackageAutoSync();

    const durationMs = Date.now() - startedAt;
    logger.info('Drug master sync cron completed', {
      cronName: 'drug_master_sync',
      method: req.method,
      durationMs,
      drugSync: drugResult,
      packageSync: packageResult,
    });

    res.json({
      message: 'ok',
      durationMs,
      drugSync: drugResult,
      packageSync: packageResult,
    });
  } catch (err) {
    logger.error('Drug master sync cron failed', {
      cronName: 'drug_master_sync',
      method: req.method,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'drug master sync failed' });
  }
}

router.post('/run', handleDrugMasterSync);

export default router;
