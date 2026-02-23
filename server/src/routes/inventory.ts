import { Router, Response } from 'express';
import { eq, like, count, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, usedMedicationItems, pharmacies } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

router.use(requireLogin);

// My dead stock list
router.get('/dead-stock', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const items = await db.select()
      .from(deadStockItems)
      .where(eq(deadStockItems.pharmacyId, req.user!.id))
      .orderBy(desc(deadStockItems.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: count() })
      .from(deadStockItems)
      .where(eq(deadStockItems.pharmacyId, req.user!.id));

    res.json({
      data: items,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    console.error('Dead stock list error:', err);
    res.status(500).json({ error: '不動在庫の取得に失敗しました' });
  }
});

// Delete dead stock item
router.delete('/dead-stock/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(deadStockItems)
      .where(eq(deadStockItems.id, id));
    res.json({ message: '削除しました' });
  } catch (err) {
    console.error('Delete dead stock error:', err);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// My used medication list
router.get('/used-medication', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const items = await db.select()
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, req.user!.id))
      .orderBy(desc(usedMedicationItems.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: count() })
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, req.user!.id));

    res.json({
      data: items,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    console.error('Used medication list error:', err);
    res.status(500).json({ error: '使用薬剤の取得に失敗しました' });
  }
});

// Browse all pharmacies' inventory
router.get('/browse', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    let query = db.select({
      id: deadStockItems.id,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      yakkaTotal: deadStockItems.yakkaTotal,
      expirationDate: deadStockItems.expirationDate,
      pharmacyName: pharmacies.name,
      prefecture: pharmacies.prefecture,
    })
      .from(deadStockItems)
      .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
      .where(eq(deadStockItems.isAvailable, true))
      .orderBy(desc(deadStockItems.createdAt))
      .limit(limit)
      .offset(offset);

    if (search) {
      query = db.select({
        id: deadStockItems.id,
        drugName: deadStockItems.drugName,
        quantity: deadStockItems.quantity,
        unit: deadStockItems.unit,
        yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
        yakkaTotal: deadStockItems.yakkaTotal,
        expirationDate: deadStockItems.expirationDate,
        pharmacyName: pharmacies.name,
        prefecture: pharmacies.prefecture,
      })
        .from(deadStockItems)
        .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
        .where(like(deadStockItems.drugName, `%${search}%`))
        .orderBy(desc(deadStockItems.createdAt))
        .limit(limit)
        .offset(offset);
    }

    const items = await query;

    res.json({
      data: items,
      pagination: { page, limit },
    });
  } catch (err) {
    console.error('Browse inventory error:', err);
    res.status(500).json({ error: '在庫参照に失敗しました' });
  }
});

export default router;
