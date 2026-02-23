import { Router, Response } from 'express';
import { and, eq, inArray, desc, sql, count } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  uploads,
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  adminMessages,
} from '../db/schema';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { isSafeInternalPath, sanitizeInternalPath } from '../utils/path-utils';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

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
      db.select({ count: count() }).from(pharmacies),
      db.select({ count: count() })
        .from(pharmacies)
        .where(eq(pharmacies.isActive, true)),
      db.select({ count: count() }).from(uploads),
      db.select({ count: count() }).from(exchangeProposals),
      db.select({ count: count() }).from(exchangeHistory),
      db.select({ count: count() })
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
    console.error('Admin stats error:', err);
    res.status(500).json({ error: '統計情報の取得に失敗しました' });
  }
});

router.get('/pharmacies/options', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      isActive: pharmacies.isActive,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.createdAt));

    res.json({
      data: rows,
    });
  } catch (err) {
    console.error('Admin pharmacy options error:', err);
    res.status(500).json({ error: '薬局候補の取得に失敗しました' });
  }
});

router.get('/pharmacies', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const rows = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      isActive: pharmacies.isActive,
      isAdmin: pharmacies.isAdmin,
      createdAt: pharmacies.createdAt,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: count() }).from(pharmacies);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (err) {
    console.error('Admin pharmacies error:', err);
    res.status(500).json({ error: '薬局一覧の取得に失敗しました' });
  }
});

router.get('/pharmacies/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const rows = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    const { passwordHash: _, ...pharmacy } = rows[0];
    res.json(pharmacy);
  } catch (err) {
    console.error('Admin pharmacy detail error:', err);
    res.status(500).json({ error: '薬局情報の取得に失敗しました' });
  }
});

router.put('/pharmacies/:id/toggle-active', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const rows = await db.select({ isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    await db.update(pharmacies)
      .set({
        isActive: !rows[0].isActive,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, id));

    res.json({ message: `薬局を${rows[0].isActive ? '無効' : '有効'}にしました` });
  } catch (err) {
    console.error('Admin toggle active error:', err);
    res.status(500).json({ error: '状態変更に失敗しました' });
  }
});

router.get('/exchanges', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const rows = await db.select()
      .from(exchangeProposals)
      .orderBy(desc(exchangeProposals.proposedAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: count() }).from(exchangeProposals);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (err) {
    console.error('Admin exchanges error:', err);
    res.status(500).json({ error: '交換一覧の取得に失敗しました' });
  }
});

router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const rows = await db.select({
      id: exchangeHistory.id,
      proposalId: exchangeHistory.proposalId,
      pharmacyAId: exchangeHistory.pharmacyAId,
      pharmacyBId: exchangeHistory.pharmacyBId,
      totalValue: exchangeHistory.totalValue,
      completedAt: exchangeHistory.completedAt,
    })
      .from(exchangeHistory)
      .orderBy(desc(exchangeHistory.completedAt))
      .limit(limit)
      .offset(offset);

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({
        id: pharmacies.id,
        name: pharmacies.name,
      })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];

    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));
    const [total] = await db.select({ count: count() }).from(exchangeHistory);

    res.json({
      data: rows.map((row) => ({
        ...row,
        pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
        pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
      })),
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (err) {
    console.error('Admin history error:', err);
    res.status(500).json({ error: '交換履歴の取得に失敗しました' });
  }
});

router.get('/messages', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const rows = await db.select({
      id: adminMessages.id,
      senderAdminId: adminMessages.senderAdminId,
      targetType: adminMessages.targetType,
      targetPharmacyId: adminMessages.targetPharmacyId,
      title: adminMessages.title,
      body: adminMessages.body,
      actionPath: adminMessages.actionPath,
      createdAt: adminMessages.createdAt,
    })
      .from(adminMessages)
      .orderBy(desc(adminMessages.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: count() }).from(adminMessages);

    res.json({
      data: rows.map((row) => ({
        ...row,
        actionPath: sanitizeInternalPath(row.actionPath) ?? null,
      })),
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (err) {
    console.error('Admin messages list error:', err);
    res.status(500).json({ error: '管理者メッセージ一覧の取得に失敗しました' });
  }
});

router.post('/messages', async (req: AuthRequest, res: Response) => {
  try {
    const targetType = req.body.targetType as 'all' | 'pharmacy';
    const targetPharmacyIdRaw = req.body.targetPharmacyId;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const actionPath = typeof req.body.actionPath === 'string' ? req.body.actionPath.trim() : '';

    if (!targetType || !['all', 'pharmacy'].includes(targetType)) {
      res.status(400).json({ error: '送信対象が不正です' });
      return;
    }

    if (!title || title.length > 100) {
      res.status(400).json({ error: 'タイトルは1〜100文字で入力してください' });
      return;
    }

    if (!body || body.length > 2000) {
      res.status(400).json({ error: '本文は1〜2000文字で入力してください' });
      return;
    }

    let targetPharmacyId: number | null = null;
    if (targetType === 'pharmacy') {
      targetPharmacyId = parsePositiveInt(String(targetPharmacyIdRaw ?? ''));
      if (!targetPharmacyId) {
        res.status(400).json({ error: '送信先薬局IDが不正です' });
        return;
      }

      const targetRows = await db.select({ id: pharmacies.id })
        .from(pharmacies)
        .where(and(
          eq(pharmacies.id, targetPharmacyId),
          eq(pharmacies.isActive, true),
        ))
        .limit(1);

      if (targetRows.length === 0) {
        res.status(404).json({ error: '送信先薬局が見つかりません' });
        return;
      }
    }

    if (actionPath && !isSafeInternalPath(actionPath)) {
      res.status(400).json({ error: '遷移先パスが不正です' });
      return;
    }

    await db.insert(adminMessages).values({
      senderAdminId: req.user!.id,
      targetType,
      targetPharmacyId,
      title,
      body,
      actionPath: actionPath || null,
    });

    res.status(201).json({ message: '加盟薬局へメッセージを送信しました' });
  } catch (err) {
    console.error('Admin message send error:', err);
    res.status(500).json({ error: 'メッセージ送信に失敗しました' });
  }
});

export default router;
