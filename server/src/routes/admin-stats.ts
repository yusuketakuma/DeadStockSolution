import { Router, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  uploads,
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
} from '../db/schema';
import { AuthRequest } from '../types';
import { rowCount } from '../utils/db-utils';
import { getObservabilitySnapshot } from '../services/observability-service';
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

router.get('/observability', async (req: AuthRequest, res: Response) => {
  try {
    const minutesRaw = Number(req.query.minutes);
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 60;
    const snapshot = getObservabilitySnapshot(minutes);
    res.json(snapshot);
  } catch (err) {
    handleAdminError(err, 'Admin observability error', '監視情報の取得に失敗しました', res);
  }
});

export default router;
