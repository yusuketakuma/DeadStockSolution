import { Router, Response } from 'express';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeHistory,
  pharmacies,
} from '../db/schema';
import { AuthRequest } from '../types';
import { parsePagination } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';

const router = Router();

// Exchange history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
      maxPage: 200,
    });
    const pharmacyId = req.user!.id;
    const ownershipFilter = or(
      eq(exchangeHistory.pharmacyAId, pharmacyId),
      eq(exchangeHistory.pharmacyBId, pharmacyId),
    );

    const [rows, [countRow]] = await Promise.all([
      db.select()
        .from(exchangeHistory)
        .where(ownershipFilter)
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(ownershipFilter),
    ]);

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

    const totalCount = countRow.count;

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
