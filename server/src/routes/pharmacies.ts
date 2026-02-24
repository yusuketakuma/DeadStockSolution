import { Router, Response } from 'express';
import { and, eq, or, like, desc, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, pharmacyBusinessHours } from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { requireLogin } from '../middleware/auth';
import { haversineDistance } from '../utils/geo-utils';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, parsePositiveInt } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';

const router = Router();
router.use(requireLogin);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const search = normalizeSearchTerm(req.query.search);
    const prefecture = normalizeSearchTerm(req.query.prefecture, 20);
    const sortBy = req.query.sortBy === 'distance' ? 'distance' : undefined;

    // Get current pharmacy coordinates for distance calculation
    const [currentPharmacy] = await db.select({
      latitude: pharmacies.latitude,
      longitude: pharmacies.longitude,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);

    const conditions = [eq(pharmacies.isActive, true)];
    if (search) {
      const normalized = normalizeKana(search);
      const hiragana = katakanaToHiragana(normalized);
      const katakana = hiraganaToKatakana(normalized);
      const likeTerms = [...new Set([normalized, hiragana, katakana])];
      const nameConditions = likeTerms.map((term) => like(pharmacies.name, `%${term}%`));
      conditions.push(nameConditions.length === 1 ? nameConditions[0] : or(...nameConditions)!);
    }
    if (prefecture) {
      conditions.push(eq(pharmacies.prefecture, prefecture));
    }
    const whereExpr = conditions.length === 1 ? conditions[0] : and(...conditions);

    const rows = await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      address: pharmacies.address,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      latitude: pharmacies.latitude,
      longitude: pharmacies.longitude,
    })
      .from(pharmacies)
      .where(whereExpr)
      .orderBy(desc(pharmacies.createdAt))
      .limit(limit)
      .offset(offset);

    // Enrich with distance
    const enriched = rows.map((row) => {
      let distance: number | null = null;
      if (
        currentPharmacy?.latitude !== null &&
        currentPharmacy?.longitude !== null &&
        row.latitude !== null &&
        row.longitude !== null
      ) {
        distance = Math.round(
          haversineDistance(currentPharmacy.latitude, currentPharmacy.longitude, row.latitude, row.longitude) * 10
        ) / 10;
      }
      return { ...row, distance };
    });

    // Fetch business hours for all pharmacies in the result
    const pharmacyIds = enriched.map((r) => r.id);
    const allHours = pharmacyIds.length > 0
      ? await db.select({
        pharmacyId: pharmacyBusinessHours.pharmacyId,
        dayOfWeek: pharmacyBusinessHours.dayOfWeek,
        openTime: pharmacyBusinessHours.openTime,
        closeTime: pharmacyBusinessHours.closeTime,
        isClosed: pharmacyBusinessHours.isClosed,
        is24Hours: pharmacyBusinessHours.is24Hours,
      })
        .from(pharmacyBusinessHours)
        .where(inArray(pharmacyBusinessHours.pharmacyId, pharmacyIds))
      : [];

    const hoursByPharmacy = new Map<number, typeof allHours>();
    for (const h of allHours) {
      const list = hoursByPharmacy.get(h.pharmacyId) ?? [];
      list.push(h);
      hoursByPharmacy.set(h.pharmacyId, list);
    }

    const now = new Date();
    const enrichedWithHours = enriched.map((row) => {
      const hours = hoursByPharmacy.get(row.id) ?? [];
      const status = getBusinessHoursStatus(hours, now);
      return {
        ...row,
        businessHours: hours.map(({ pharmacyId: _, ...rest }) => rest),
        businessStatus: status,
      };
    });

    let result = enrichedWithHours;

    // Sort by distance if requested
    if (sortBy === 'distance') {
      result.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
    }

    const [total] = await db.select({ count: rowCount }).from(pharmacies).where(whereExpr);

    res.json({
      data: result,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    console.error('Pharmacies list error:', err);
    res.status(500).json({ error: '薬局一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const [pharmacy] = await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      address: pharmacies.address,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (!pharmacy) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    res.json(pharmacy);
  } catch (err) {
    console.error('Pharmacy detail error:', err);
    res.status(500).json({ error: '薬局情報の取得に失敗しました' });
  }
});

export default router;
