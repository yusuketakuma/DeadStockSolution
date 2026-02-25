import { Router, Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeProposals, exchangeProposalItems, exchangeHistory, deadStockItems, pharmacies } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { findMatches } from '../services/matching-service';
import { createProposal, acceptProposal, rejectProposal, completeProposal } from '../services/exchange-service';
import { processPendingMatchingRefreshJobs } from '../services/matching-refresh-service';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';

const router = Router();
router.use(requireLogin);

function isProposalInputError(message: string): boolean {
  return [
    '不正',
    '見つかりません',
    '在庫',
    '薬局',
    'マッチング',
    '提案',
    '交換金額',
    '数量',
  ].some((token) => message.includes(token));
}

function timestampSortValue(timestamp: string | null): number {
  if (timestamp === null) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function mergeDedupSortByTimestamp<T extends { id: number }>(
  branchA: T[],
  branchB: T[],
  getTimestamp: (row: T) => string | null,
): T[] {
  const deduped = new Map<number, T>();
  for (const row of branchA) deduped.set(row.id, row);
  for (const row of branchB) {
    if (!deduped.has(row.id)) deduped.set(row.id, row);
  }

  return [...deduped.values()].sort((left, right) => {
    const leftSort = timestampSortValue(getTimestamp(left));
    const rightSort = timestampSortValue(getTimestamp(right));
    return rightSort - leftSort || right.id - left.id;
  });
}

// Find matching candidates
router.post('/find', async (req: AuthRequest, res: Response) => {
  try {
    await processPendingMatchingRefreshJobs().catch((err) => {
      logger.warn('Processing pending matching refresh jobs failed before find', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const candidates = await findMatches(req.user!.id);
    res.json({ candidates });
  } catch (err) {
    logger.error('Find matches error:', { error: (err as Error).message });
    const message = process.env.NODE_ENV === 'production'
      ? 'マッチングに失敗しました'
      : (err instanceof Error ? err.message : 'マッチングに失敗しました');
    res.status(500).json({ error: message });
  }
});

// Create proposal from selected candidate
router.post('/proposals', async (req: AuthRequest, res: Response) => {
  try {
    const candidate = req.body?.candidate;
    if (!candidate || typeof candidate !== 'object') {
      res.status(400).json({ error: '候補データが必要です' });
      return;
    }

    const proposalId = await createProposal(req.user!.id, candidate);
    res.status(201).json({ proposalId, message: '仮マッチングを開始しました' });
  } catch (err) {
    logger.error('Create proposal error:', { error: (err as Error).message });
    if (err instanceof Error && isProposalInputError(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: '仮マッチングの作成に失敗しました' });
  }
});

// List my proposals
router.get('/proposals', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const pharmacyId = req.user!.id;
    const fetchSize = offset + limit;
    const proposalSelect = {
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      totalValueA: exchangeProposals.totalValueA,
      totalValueB: exchangeProposals.totalValueB,
      valueDifference: exchangeProposals.valueDifference,
      proposedAt: exchangeProposals.proposedAt,
    };

    const [branchA, branchB, [countA], [countB], [countOverlap]] = await Promise.all([
      db.select(proposalSelect)
        .from(exchangeProposals)
        .where(eq(exchangeProposals.pharmacyAId, pharmacyId))
        .orderBy(desc(exchangeProposals.proposedAt), desc(exchangeProposals.id))
        .limit(fetchSize),
      db.select(proposalSelect)
        .from(exchangeProposals)
        .where(eq(exchangeProposals.pharmacyBId, pharmacyId))
        .orderBy(desc(exchangeProposals.proposedAt), desc(exchangeProposals.id))
        .limit(fetchSize),
      db.select({ count: rowCount })
        .from(exchangeProposals)
        .where(eq(exchangeProposals.pharmacyAId, pharmacyId)),
      db.select({ count: rowCount })
        .from(exchangeProposals)
        .where(eq(exchangeProposals.pharmacyBId, pharmacyId)),
      db.select({ count: rowCount })
        .from(exchangeProposals)
        .where(and(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          eq(exchangeProposals.pharmacyBId, pharmacyId),
        )),
    ]);

    const rows = mergeDedupSortByTimestamp(branchA, branchB, (row) => row.proposedAt)
      .slice(offset, offset + limit);

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];
    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

    const enriched = rows.map((row) => ({
      ...row,
      pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
      pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
    }));

    const totalCount = countA.count + countB.count - countOverlap.count;

    res.json({
      data: enriched,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (err) {
    logger.error('List proposals error:', { error: (err as Error).message });
    res.status(500).json({ error: 'マッチング一覧の取得に失敗しました' });
  }
});

// Proposal detail
router.get('/proposals/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const pharmacyId = req.user!.id;

    const [proposal] = await db.select()
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, id))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    if (proposal.pharmacyAId !== pharmacyId && proposal.pharmacyBId !== pharmacyId) {
      res.status(403).json({ error: 'アクセス権限がありません' });
      return;
    }

    // Get items
    const items = await db.select({
      id: exchangeProposalItems.id,
      deadStockItemId: exchangeProposalItems.deadStockItemId,
      fromPharmacyId: exchangeProposalItems.fromPharmacyId,
      toPharmacyId: exchangeProposalItems.toPharmacyId,
      quantity: exchangeProposalItems.quantity,
      yakkaValue: exchangeProposalItems.yakkaValue,
      drugName: deadStockItems.drugName,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    })
      .from(exchangeProposalItems)
      .innerJoin(deadStockItems, eq(exchangeProposalItems.deadStockItemId, deadStockItems.id))
      .where(eq(exchangeProposalItems.proposalId, id));

    // Get pharmacy info
    const [[pharmA], [pharmB]] = await Promise.all([
      db.select({
        name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
        address: pharmacies.address, prefecture: pharmacies.prefecture,
      }).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1),
      db.select({
        name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
        address: pharmacies.address, prefecture: pharmacies.prefecture,
      }).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1),
    ]);

    res.json({
      proposal,
      items,
      pharmacyA: { id: proposal.pharmacyAId, ...pharmA },
      pharmacyB: { id: proposal.pharmacyBId, ...pharmB },
    });
  } catch (err) {
    logger.error('Proposal detail error:', { error: (err as Error).message });
    res.status(500).json({ error: 'マッチング詳細の取得に失敗しました' });
  }
});

// Print data
router.get('/proposals/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    // Reuse detail logic
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const pharmacyId = req.user!.id;

    const [proposal] = await db.select()
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, id))
      .limit(1);

    if (!proposal) { res.status(404).json({ error: '提案が見つかりません' }); return; }
    if (proposal.pharmacyAId !== pharmacyId && proposal.pharmacyBId !== pharmacyId) {
      res.status(403).json({ error: 'アクセス権限がありません' }); return;
    }

    const items = await db.select({
      id: exchangeProposalItems.id,
      fromPharmacyId: exchangeProposalItems.fromPharmacyId,
      toPharmacyId: exchangeProposalItems.toPharmacyId,
      quantity: exchangeProposalItems.quantity,
      yakkaValue: exchangeProposalItems.yakkaValue,
      drugName: deadStockItems.drugName,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    })
      .from(exchangeProposalItems)
      .innerJoin(deadStockItems, eq(exchangeProposalItems.deadStockItemId, deadStockItems.id))
      .where(eq(exchangeProposalItems.proposalId, id));

    const printFields = {
      name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
      address: pharmacies.address, prefecture: pharmacies.prefecture, licenseNumber: pharmacies.licenseNumber,
    };
    const [[pharmA], [pharmB]] = await Promise.all([
      db.select(printFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1),
      db.select(printFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1),
    ]);

    res.json({
      proposal,
      items,
      pharmacyA: pharmA ?? null,
      pharmacyB: pharmB ?? null,
    });
  } catch (err) {
    logger.error('Print data error:', { error: (err as Error).message });
    res.status(500).json({ error: '印刷データの取得に失敗しました' });
  }
});

// Accept proposal
router.post('/proposals/:id/accept', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const newStatus = await acceptProposal(id, req.user!.id);
    const msg = newStatus === 'confirmed' ? '仮マッチングが確定しました' : '仮マッチングを承認しました（相手薬局の承認待ち）';
    res.json({ message: msg, status: newStatus });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '承認に失敗しました' });
  }
});

// Reject proposal
router.post('/proposals/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    await rejectProposal(id, req.user!.id);
    res.json({ message: '仮マッチングを拒否しました' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '拒否に失敗しました' });
  }
});

// Complete exchange
router.post('/proposals/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    await completeProposal(id, req.user!.id);
    res.json({ message: '交換を完了しました' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '完了処理に失敗しました' });
  }
});

// Exchange history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const pharmacyId = req.user!.id;
    const fetchSize = offset + limit;

    const [branchA, branchB, [countA], [countB], [countOverlap]] = await Promise.all([
      db.select()
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyAId, pharmacyId))
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(fetchSize),
      db.select()
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyBId, pharmacyId))
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(fetchSize),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyAId, pharmacyId)),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyBId, pharmacyId)),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(and(
          eq(exchangeHistory.pharmacyAId, pharmacyId),
          eq(exchangeHistory.pharmacyBId, pharmacyId),
        )),
    ]);

    const rows = mergeDedupSortByTimestamp(branchA, branchB, (row) => row.completedAt)
      .slice(offset, offset + limit);

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];
    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

    const enriched = rows.map((row) => ({
      ...row,
      pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
      pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
    }));

    const totalCount = countA.count + countB.count - countOverlap.count;

    res.json({
      data: enriched,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (err) {
    logger.error('Exchange history error:', { error: (err as Error).message });
    res.status(500).json({ error: '交換履歴の取得に失敗しました' });
  }
});

export default router;
