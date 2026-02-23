import { Router, Response } from 'express';
import { eq, or, and, desc, count } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeProposals, exchangeProposalItems, exchangeHistory, deadStockItems, pharmacies } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest, MatchCandidate } from '../types';
import { findMatches } from '../services/matching-service';
import { createProposal, acceptProposal, rejectProposal, completeProposal } from '../services/exchange-service';

const router = Router();
router.use(requireLogin);

// Find matching candidates
router.post('/find', async (req: AuthRequest, res: Response) => {
  try {
    const candidates = await findMatches(req.user!.id);
    res.json({ candidates });
  } catch (err) {
    console.error('Find matches error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'マッチングに失敗しました' });
  }
});

// Create proposal from selected candidate
router.post('/proposals', async (req: AuthRequest, res: Response) => {
  try {
    const candidate: MatchCandidate = req.body.candidate;
    if (!candidate) {
      res.status(400).json({ error: '候補データが必要です' });
      return;
    }

    const proposalId = await createProposal(req.user!.id, candidate);
    res.status(201).json({ proposalId, message: '交換提案を送信しました' });
  } catch (err) {
    console.error('Create proposal error:', err);
    res.status(500).json({ error: '提案の作成に失敗しました' });
  }
});

// List my proposals
router.get('/proposals', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const pharmacyId = req.user!.id;

    const rows = await db.select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      totalValueA: exchangeProposals.totalValueA,
      totalValueB: exchangeProposals.totalValueB,
      valueDifference: exchangeProposals.valueDifference,
      proposedAt: exchangeProposals.proposedAt,
    })
      .from(exchangeProposals)
      .where(or(
        eq(exchangeProposals.pharmacyAId, pharmacyId),
        eq(exchangeProposals.pharmacyBId, pharmacyId),
      ))
      .orderBy(desc(exchangeProposals.proposedAt))
      .limit(limit)
      .offset(offset);

    // Enrich with pharmacy names
    const enriched = await Promise.all(rows.map(async (row) => {
      const [pharmA] = await db.select({ name: pharmacies.name }).from(pharmacies).where(eq(pharmacies.id, row.pharmacyAId)).limit(1);
      const [pharmB] = await db.select({ name: pharmacies.name }).from(pharmacies).where(eq(pharmacies.id, row.pharmacyBId)).limit(1);
      return {
        ...row,
        pharmacyAName: pharmA?.name ?? '',
        pharmacyBName: pharmB?.name ?? '',
      };
    }));

    const [total] = await db.select({ count: count() })
      .from(exchangeProposals)
      .where(or(
        eq(exchangeProposals.pharmacyAId, pharmacyId),
        eq(exchangeProposals.pharmacyBId, pharmacyId),
      ));

    res.json({
      data: enriched,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    console.error('List proposals error:', err);
    res.status(500).json({ error: '提案一覧の取得に失敗しました' });
  }
});

// Proposal detail
router.get('/proposals/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const pharmacyId = req.user!.id;

    const [proposal] = await db.select()
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, id))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: '提案が見つかりません' });
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
    const [pharmA] = await db.select({
      name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
      address: pharmacies.address, prefecture: pharmacies.prefecture,
    }).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1);

    const [pharmB] = await db.select({
      name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
      address: pharmacies.address, prefecture: pharmacies.prefecture,
    }).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1);

    res.json({
      proposal,
      items,
      pharmacyA: { id: proposal.pharmacyAId, ...pharmA },
      pharmacyB: { id: proposal.pharmacyBId, ...pharmB },
    });
  } catch (err) {
    console.error('Proposal detail error:', err);
    res.status(500).json({ error: '提案詳細の取得に失敗しました' });
  }
});

// Print data
router.get('/proposals/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    // Reuse detail logic
    const id = parseInt(req.params.id as string);
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

    const [pharmA] = await db.select().from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1);
    const [pharmB] = await db.select().from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1);

    res.json({
      proposal,
      items,
      pharmacyA: pharmA ? { name: pharmA.name, phone: pharmA.phone, fax: pharmA.fax, address: pharmA.address, prefecture: pharmA.prefecture, licenseNumber: pharmA.licenseNumber } : null,
      pharmacyB: pharmB ? { name: pharmB.name, phone: pharmB.phone, fax: pharmB.fax, address: pharmB.address, prefecture: pharmB.prefecture, licenseNumber: pharmB.licenseNumber } : null,
    });
  } catch (err) {
    console.error('Print data error:', err);
    res.status(500).json({ error: '印刷データの取得に失敗しました' });
  }
});

// Accept proposal
router.post('/proposals/:id/accept', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const newStatus = await acceptProposal(id, req.user!.id);
    res.json({ message: '提案を承認しました', status: newStatus });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '承認に失敗しました' });
  }
});

// Reject proposal
router.post('/proposals/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await rejectProposal(id, req.user!.id);
    res.json({ message: '提案を拒否しました' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '拒否に失敗しました' });
  }
});

// Complete exchange
router.post('/proposals/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await completeProposal(id, req.user!.id);
    res.json({ message: '交換を完了しました' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '完了処理に失敗しました' });
  }
});

// Exchange history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const pharmacyId = req.user!.id;

    const rows = await db.select()
      .from(exchangeHistory)
      .where(or(
        eq(exchangeHistory.pharmacyAId, pharmacyId),
        eq(exchangeHistory.pharmacyBId, pharmacyId),
      ))
      .orderBy(desc(exchangeHistory.completedAt))
      .limit(limit)
      .offset(offset);

    const enriched = await Promise.all(rows.map(async (row) => {
      const [pharmA] = await db.select({ name: pharmacies.name }).from(pharmacies).where(eq(pharmacies.id, row.pharmacyAId)).limit(1);
      const [pharmB] = await db.select({ name: pharmacies.name }).from(pharmacies).where(eq(pharmacies.id, row.pharmacyBId)).limit(1);
      return { ...row, pharmacyAName: pharmA?.name ?? '', pharmacyBName: pharmB?.name ?? '' };
    }));

    const [total] = await db.select({ count: count() })
      .from(exchangeHistory)
      .where(or(
        eq(exchangeHistory.pharmacyAId, pharmacyId),
        eq(exchangeHistory.pharmacyBId, pharmacyId),
      ));

    res.json({
      data: enriched,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    console.error('Exchange history error:', err);
    res.status(500).json({ error: '交換履歴の取得に失敗しました' });
  }
});

export default router;
