import { Router, Response } from 'express';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  uploadJobs,
  exchangeProposals,
  exchangeProposalItems,
  notifications,
  events,
} from '../db/schema';
import { AuthRequest } from '../types';
import { rowCount } from '../utils/db-utils';
import { getObservabilitySnapshot } from '../services/observability-service';
import { getMonitoringKpiSnapshot } from '../services/monitoring-kpi-service';
import { getLogPushStats } from '../services/openclaw-log-push-service';
import { handleAdminError } from './admin-utils';

const router = Router();

function parseRequestedMinutes(rawValue: unknown, fallback = 60): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchAdminStatsSnapshot() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [
    [pharmacyCount],
    [activePharmacyCount],
    [uploadCount],
    [proposalCount],
    [historyCount],
    [pickupCount],
    [exchangeAmount],
    [activePharmacies30d],
    [monthlyExchangeValue],
  ] = await Promise.all([
    db.select({ count: rowCount }).from(pharmacies),
    db.select({ count: rowCount })
      .from(pharmacies)
      .where(eq(pharmacies.isActive, true)),
    db.select({ count: rowCount }).from(uploadJobs),
    db.select({ count: rowCount }).from(exchangeProposals),
    db.select({ count: rowCount }).from(exchangeProposals).where(eq(exchangeProposals.status, 'completed')),
    db.select({ count: rowCount })
      .from(exchangeProposalItems)
      .innerJoin(exchangeProposals, eq(exchangeProposalItems.proposalId, exchangeProposals.id))
      .where(eq(exchangeProposals.status, 'completed')),
    db.select({
      total: sql<number>`coalesce(sum(${exchangeProposals.completedTotalValue}), 0)`,
    }).from(exchangeProposals).where(eq(exchangeProposals.status, 'completed')),
    db.select({
      count: sql<number>`count(distinct ${events.pharmacyId})::int`,
    }).from(events).where(
      and(
        sql`${events.action} IN ('login', 'admin_login')`,
        gte(events.createdAt, thirtyDaysAgo),
      ),
    ),
    db.select({
      total: sql<number>`coalesce(sum(${exchangeProposals.completedTotalValue}), 0)`,
    }).from(exchangeProposals).where(
      and(
        eq(exchangeProposals.status, 'completed'),
        gte(exchangeProposals.completedAt, monthStart),
      ),
    ),
  ]);

  const totalPharmacies = pharmacyCount.count;
  const activeRate30d = totalPharmacies > 0 ? activePharmacies30d.count / totalPharmacies : 0;
  const proposalCompletionRate = proposalCount.count > 0 ? historyCount.count / proposalCount.count : 0;

  return {
    pharmacyCount: totalPharmacies,
    activePharmacyCount: activePharmacyCount.count,
    uploadCount: uploadCount.count,
    proposalCount: proposalCount.count,
    historyCount: historyCount.count,
    pickupCount: pickupCount.count,
    exchangeAmount: Number(exchangeAmount.total ?? 0),
    activeRate30d,
    proposalCompletionRate,
    monthlyExchangeValue: Number(monthlyExchangeValue.total ?? 0),
  };
}

async function fetchAdminAlertSnapshot(since: string) {
  const [
    [failedUploadJobs],
    [stalledUploadJobs],
    [unreadNotificationsCount],
    [pendingProposalsCount],
  ] = await Promise.all([
    db.select({ count: rowCount })
      .from(uploadJobs)
      .where(and(eq(uploadJobs.status, 'failed'), gte(uploadJobs.createdAt, since))),
    db.select({ count: rowCount })
      .from(uploadJobs)
      .where(and(eq(uploadJobs.status, 'pending'), gte(uploadJobs.createdAt, since))),
    db.select({ count: rowCount })
      .from(notifications)
      .where(eq(notifications.isRead, false)),
    db.select({ count: rowCount })
      .from(exchangeProposals)
      .where(and(
        gte(exchangeProposals.proposedAt, since),
        sql`${exchangeProposals.status} IN ('proposed', 'accepted_a', 'accepted_b')`,
      )),
  ]);

  return {
    failedUploadJobs24h: failedUploadJobs.count,
    stalledUploadJobs24h: stalledUploadJobs.count,
    unreadNotifications: unreadNotificationsCount.count,
    pendingProposalActions24h: pendingProposalsCount.count,
  };
}

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const snapshot = await fetchAdminStatsSnapshot();

    res.json({
      totalPharmacies: snapshot.pharmacyCount,
      activePharmacies: snapshot.activePharmacyCount,
      inactivePharmacies: snapshot.pharmacyCount - snapshot.activePharmacyCount,
      totalUploads: snapshot.uploadCount,
      totalProposals: snapshot.proposalCount,
      totalExchanges: snapshot.historyCount,
      totalPickupItems: snapshot.pickupCount,
      totalExchangeValue: snapshot.exchangeAmount,
      activeRate30d: snapshot.activeRate30d,
      proposalCompletionRate: snapshot.proposalCompletionRate,
      monthlyExchangeValue: snapshot.monthlyExchangeValue,
    });
  } catch (err) {
    handleAdminError(err, 'Admin stats error', '統計情報の取得に失敗しました', res);
  }
});


router.get('/alerts', async (_req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    res.json(await fetchAdminAlertSnapshot(since));
  } catch (err) {
    handleAdminError(err, 'Admin alerts error', 'アラート集計の取得に失敗しました', res);
  }
});


router.get('/kpis', async (req: AuthRequest, res: Response) => {
  try {
    const minutes = parseRequestedMinutes(req.query.minutes);
    const snapshot = await getMonitoringKpiSnapshot(minutes);
    res.json(snapshot);
  } catch (err) {
    handleAdminError(err, 'Admin KPI snapshot error', 'KPI監視情報の取得に失敗しました', res);
  }
});

router.get('/observability', async (req: AuthRequest, res: Response) => {
  try {
    const minutes = parseRequestedMinutes(req.query.minutes);
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
