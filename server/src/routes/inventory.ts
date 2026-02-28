import { Router, Response } from 'express';
import { eq, and, or, like, desc, inArray, notExists } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  usedMedicationItems,
  pharmacies,
  pharmacyBusinessHours,
  pharmacySpecialHours,
  pharmacyRelationships,
} from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { groupBy } from '../utils/array-utils';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, escapeLikeWildcards } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import { logger } from '../services/logger';
import { writeLog, getClientIp } from '../services/log-service';
import { getPharmacyRiskDetail } from '../services/expiry-risk-service';

const router = Router();

router.use(requireLogin);

// My dead stock expiry risk summary
router.get('/dead-stock/risk', async (req: AuthRequest, res: Response) => {
  try {
    const detail = await getPharmacyRiskDetail(req.user!.id);
    res.json(detail);
  } catch (err) {
    logger.error('Dead stock risk summary error:', { error: (err as Error).message });
    const message = err instanceof Error && err.message.includes('見つかりません')
      ? err.message
      : '期限切れリスク集計の取得に失敗しました';
    res.status(message.includes('見つかりません') ? 404 : 500).json({ error: message });
  }
});

// My dead stock list
router.get('/dead-stock', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const items = await db.select()
      .from(deadStockItems)
      .where(eq(deadStockItems.pharmacyId, req.user!.id))
      .orderBy(desc(deadStockItems.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount })
      .from(deadStockItems)
      .where(eq(deadStockItems.pharmacyId, req.user!.id));

    res.json({
      data: items,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    logger.error('Dead stock list error:', { error: (err as Error).message });
    res.status(500).json({ error: 'デッドストックリストの取得に失敗しました' });
  }
});

// Delete dead stock item
router.delete('/dead-stock/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const deleted = await db.delete(deadStockItems)
      .where(and(
        eq(deadStockItems.id, id),
        eq(deadStockItems.pharmacyId, req.user!.id),
      ))
      .returning({ id: deadStockItems.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: '対象データが見つかりません' });
      return;
    }

    void writeLog('dead_stock_delete', {
      pharmacyId: req.user!.id,
      detail: `在庫ID:${id} を削除`,
      ipAddress: getClientIp(req),
    });

    res.json({ message: '削除しました' });
  } catch (err) {
    logger.error('Delete dead stock error:', { error: (err as Error).message });
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// My used medication list
router.get('/used-medication', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const items = await db.select()
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, req.user!.id))
      .orderBy(desc(usedMedicationItems.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount })
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, req.user!.id));

    res.json({
      data: items,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    logger.error('Used medication list error:', { error: (err as Error).message });
    res.status(500).json({ error: '医薬品使用量リストの取得に失敗しました' });
  }
});

// Browse all pharmacies' inventory
router.get('/browse', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const search = normalizeSearchTerm(req.query.search);

    let searchCondition;
    if (search) {
      const normalized = normalizeKana(search);
      const hiragana = katakanaToHiragana(normalized);
      const katakana = hiraganaToKatakana(normalized);
      const likeTerms = [...new Set([normalized, hiragana, katakana])];
      const likeConditions = likeTerms.map((term) => like(deadStockItems.drugName, `%${escapeLikeWildcards(term)}%`));
      searchCondition = likeConditions.length === 1 ? likeConditions[0] : or(...likeConditions);
    }

    const blockCondition = notExists(
      db.select({ id: pharmacyRelationships.id })
        .from(pharmacyRelationships)
        .where(and(
          eq(pharmacyRelationships.relationshipType, 'blocked'),
          or(
            and(
              eq(pharmacyRelationships.pharmacyId, req.user!.id),
              eq(pharmacyRelationships.targetPharmacyId, deadStockItems.pharmacyId),
            ),
            and(
              eq(pharmacyRelationships.pharmacyId, deadStockItems.pharmacyId),
              eq(pharmacyRelationships.targetPharmacyId, req.user!.id),
            ),
          ),
        ))
    );

    const whereExpr = and(
      eq(deadStockItems.isAvailable, true),
      eq(pharmacies.isActive, true),
      searchCondition,
      blockCondition,
    );

    const items = await db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      packageLabel: deadStockItems.packageLabel,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      yakkaTotal: deadStockItems.yakkaTotal,
      expirationDate: deadStockItems.expirationDate,
      pharmacyName: pharmacies.name,
      prefecture: pharmacies.prefecture,
    })
      .from(deadStockItems)
      .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
      .where(whereExpr)
      .orderBy(desc(deadStockItems.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch business hours for pharmacies in results
    const pharmacyIds = [...new Set(items.map((i) => i.pharmacyId))];
    const [allHours, allSpecialHours] = pharmacyIds.length > 0
      ? await Promise.all([
        db.select({
          pharmacyId: pharmacyBusinessHours.pharmacyId,
          dayOfWeek: pharmacyBusinessHours.dayOfWeek,
          openTime: pharmacyBusinessHours.openTime,
          closeTime: pharmacyBusinessHours.closeTime,
          isClosed: pharmacyBusinessHours.isClosed,
          is24Hours: pharmacyBusinessHours.is24Hours,
        })
          .from(pharmacyBusinessHours)
          .where(inArray(pharmacyBusinessHours.pharmacyId, pharmacyIds)),
        db.select({
          pharmacyId: pharmacySpecialHours.pharmacyId,
          id: pharmacySpecialHours.id,
          specialType: pharmacySpecialHours.specialType,
          startDate: pharmacySpecialHours.startDate,
          endDate: pharmacySpecialHours.endDate,
          openTime: pharmacySpecialHours.openTime,
          closeTime: pharmacySpecialHours.closeTime,
          isClosed: pharmacySpecialHours.isClosed,
          is24Hours: pharmacySpecialHours.is24Hours,
          note: pharmacySpecialHours.note,
          updatedAt: pharmacySpecialHours.updatedAt,
        })
          .from(pharmacySpecialHours)
          .where(inArray(pharmacySpecialHours.pharmacyId, pharmacyIds)),
      ])
      : [[], []];

    const hoursByPharmacy = groupBy(allHours, (h) => h.pharmacyId);
    const specialHoursByPharmacy = groupBy(allSpecialHours, (h) => h.pharmacyId);

    const now = new Date();
    const enrichedItems = items.map(({ pharmacyId, ...item }) => {
      const hours = hoursByPharmacy.get(pharmacyId) ?? [];
      const specialHours = specialHoursByPharmacy.get(pharmacyId) ?? [];
      const status = getBusinessHoursStatus(hours, specialHours, now);
      const isConfigured = hours.length > 0 || specialHours.length > 0;
      return { ...item, businessStatus: { ...status, isConfigured } };
    });

    const [total] = await db.select({ count: rowCount })
      .from(deadStockItems)
      .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
      .where(whereExpr);

    res.json({
      data: enrichedItems,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    logger.error('Browse inventory error:', { error: (err as Error).message });
    res.status(500).json({ error: '在庫参照に失敗しました' });
  }
});

export default router;
