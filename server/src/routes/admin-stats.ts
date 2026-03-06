import { Router, Response } from 'express';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  uploads,
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  uploadConfirmJobs,
  notifications,
  matchNotifications,
} from '../db/schema';
import { AuthRequest } from '../types';
import { rowCount } from '../utils/db-utils';
import { getObservabilitySnapshot } from '../services/observability-service';
import { getMonitoringKpiSnapshot } from '../services/monitoring-kpi-service';
import { getLogPushStats } from '../services/openclaw-log-push-service';
import { handleAdminError } from './admin-utils';

const router = Router();


router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [
      [pharmacyCount],
      [activePharmacyCount],
      [uploadCount],
      [proposalCount],
      [historyCount],
      [pickupCount],
      [exchangeAmount],
    ] = await Promise.all([
      db.select({ count: rowCount }).from(pharmacies),
      db.select({ count: rowCount })
        .from(pharmacies)
        .where(eq(pharmacies.isActive, true)),
      db.select({ count: rowCount }).from(uploads),
      db.select({ count: rowCount }).from(exchangeProposals),
      db.select({ count: rowCount }).from(exchangeHistory),
      db.select({ count: rowCount })
        .from(exchangeProposalItems)
        .innerJoin(exchangeProposals, eq(exchangeProposalItems.proposalId, exchangeProposals.id))
        .where(eq(exchangeProposals.status, 'completed')),
      db.select({
        total: sql<number>`coalesce(sum(${exchangeHistory.totalValue}), 0)`,
      }).from(exchangeHistory),
    ]);

    res.json({
      totalPharmacies: pharmacyCount.count,
      activePharmacies: activePharmacyCount.count,
      inactivePharmacies: pharmacyCount.count - activePharmacyCount.count,
      totalUploads: uploadCount.count,
      totalProposals: proposalCount.count,
      totalExchanges: historyCount.count,
      totalPickupItems: pickupCount.count,
      totalExchangeValue: Number(exchangeAmount.total ?? 0),
    });
  } catch (err) {
    handleAdminError(err, 'Admin stats error', '統計情報の取得に失敗しました', res);
  }
});


router.get('/alerts', async (_req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      [failedUploadJobs],
      [stalledUploadJobs],
      [unreadNotificationsCount],
      [unreadMatchNotificationsCount],
      [pendingProposalsCount],
    ] = await Promise.all([
      db.select({ count: rowCount })
        .from(uploadConfirmJobs)
        .where(and(eq(uploadConfirmJobs.status, 'failed'), gte(uploadConfirmJobs.createdAt, since))),
      db.select({ count: rowCount })
        .from(uploadConfirmJobs)
        .where(and(eq(uploadConfirmJobs.status, 'pending'), gte(uploadConfirmJobs.createdAt, since))),
      db.select({ count: rowCount })
        .from(notifications)
        .where(eq(notifications.isRead, false)),
      db.select({ count: rowCount })
        .from(matchNotifications)
        .where(eq(matchNotifications.isRead, false)),
      db.select({ count: rowCount })
        .from(exchangeProposals)
        .where(and(
          gte(exchangeProposals.proposedAt, since),
          sql`${exchangeProposals.status} IN ('proposed', 'accepted_a', 'accepted_b')`,
        )),
    ]);

    res.json({
      failedUploadJobs24h: failedUploadJobs.count,
      stalledUploadJobs24h: stalledUploadJobs.count,
      unreadNotifications: unreadNotificationsCount.count + unreadMatchNotificationsCount.count,
      pendingProposalActions24h: pendingProposalsCount.count,
    });
  } catch (err) {
    handleAdminError(err, 'Admin alerts error', 'アラート集計の取得に失敗しました', res);
  }
});


router.get('/kpis', async (req: AuthRequest, res: Response) => {
  try {
    const minutesRaw = Number(req.query.minutes);
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 60;
    const snapshot = await getMonitoringKpiSnapshot(minutes);
    res.json(snapshot);
  } catch (err) {
    handleAdminError(err, 'Admin KPI snapshot error', 'KPI監視情報の取得に失敗しました', res);
  }
});

router.get('/observability', async (req: AuthRequest, res: Response) => {
  try {
    const minutesRaw = Number(req.query.minutes);
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 60;
    const snapshot = getObservabilitySnapshot(minutes);
    res.json({
      ...snapshot,
      logPush: getLogPushStats(),
    });
  } catch (err) {
    handleAdminError(err, 'Admin observability error', '監視情報の取得に失敗しました', res);
  }
});

export default router;
