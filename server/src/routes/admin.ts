import { Router, Response } from 'express';
import { eq, desc, sql, count } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, uploads, deadStockItems, exchangeProposals, exchangeHistory } from '../db/schema';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [pharmacyCount] = await db.select({ count: count() }).from(pharmacies);
    const [uploadCount] = await db.select({ count: count() }).from(uploads);
    const [proposalCount] = await db.select({ count: count() }).from(exchangeProposals);
    const [historyCount] = await db.select({ count: count() }).from(exchangeHistory);

    res.json({
      totalPharmacies: pharmacyCount.count,
      totalUploads: uploadCount.count,
      totalProposals: proposalCount.count,
      totalExchanges: historyCount.count,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: '統計情報の取得に失敗しました' });
  }
});

router.get('/pharmacies', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

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
    const id = parseInt(req.params.id as string);
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
    const id = parseInt(req.params.id as string);
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

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

export default router;
