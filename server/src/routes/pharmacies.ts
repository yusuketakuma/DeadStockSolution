import { Router, Response } from 'express';
import { and, eq, or, like, desc, inArray, asc, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, pharmacyBusinessHours, pharmacySpecialHours, pharmacyRelationships } from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { requireLogin } from '../middleware/auth';
import { haversineDistance } from '../utils/geo-utils';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, parsePositiveInt, escapeLikeWildcards } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import { logger } from '../services/logger';

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

    const [currentPharmacy] = sortBy === 'distance'
      ? await db.select({
        latitude: pharmacies.latitude,
        longitude: pharmacies.longitude,
      })
        .from(pharmacies)
        .where(eq(pharmacies.id, req.user!.id))
        .limit(1)
      : [null];

    const conditions = [eq(pharmacies.isActive, true)];
    if (search) {
      const normalized = normalizeKana(search);
      const hiragana = katakanaToHiragana(normalized);
      const katakana = hiraganaToKatakana(normalized);
      const likeTerms = [...new Set([normalized, hiragana, katakana])];
      const nameConditions = likeTerms.map((term) => like(pharmacies.name, `%${escapeLikeWildcards(term)}%`));
      conditions.push(nameConditions.length === 1 ? nameConditions[0] : or(...nameConditions)!);
    }
    if (prefecture) {
      conditions.push(eq(pharmacies.prefecture, prefecture));
    }
    const whereExpr = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [total] = await db.select({ count: rowCount }).from(pharmacies).where(whereExpr);

    const hasCurrentCoords =
      currentPharmacy?.latitude !== null &&
      currentPharmacy?.longitude !== null &&
      currentPharmacy?.latitude !== undefined &&
      currentPharmacy?.longitude !== undefined;
    const originLatitude = hasCurrentCoords ? currentPharmacy.latitude : null;
    const originLongitude = hasCurrentCoords ? currentPharmacy.longitude : null;

    const distanceExpr = hasCurrentCoords
      ? sql<number>`CASE
          WHEN ${pharmacies.latitude} IS NULL OR ${pharmacies.longitude} IS NULL THEN NULL
          ELSE (
            6371 * 2 * ASIN(
              SQRT(
                POWER(SIN(RADIANS((${pharmacies.latitude} - ${originLatitude}) / 2)), 2) +
                COS(RADIANS(${originLatitude})) * COS(RADIANS(${pharmacies.latitude})) *
                POWER(SIN(RADIANS((${pharmacies.longitude} - ${originLongitude}) / 2)), 2)
              )
            )
          )
        END`
      : sql<null>`NULL`;

    const selectFields = {
      id: pharmacies.id,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      address: pharmacies.address,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      latitude: pharmacies.latitude,
      longitude: pharmacies.longitude,
      distance: sortBy === 'distance' ? distanceExpr : sql<null>`NULL`,
    };

    const baseRows = sortBy === 'distance'
      ? hasCurrentCoords
        ? await db.select(selectFields)
          .from(pharmacies)
          .where(whereExpr)
          .orderBy(sql`COALESCE(${distanceExpr}, 999999)`, asc(pharmacies.name))
          .limit(limit)
          .offset(offset)
        : await db.select(selectFields)
          .from(pharmacies)
          .where(whereExpr)
          .orderBy(asc(pharmacies.name))
          .limit(limit)
          .offset(offset)
      : await db.select(selectFields)
        .from(pharmacies)
        .where(whereExpr)
        .orderBy(desc(pharmacies.createdAt))
        .limit(limit)
        .offset(offset);

    const withDistance = baseRows.map((row) => {
      let distance = row.distance === null ? null : Number(row.distance);
      if (!Number.isFinite(distance as number)) {
        distance = null;
      }
      if (
        distance === null &&
        originLatitude !== null &&
        originLongitude !== null &&
        row.latitude !== null &&
        row.longitude !== null
      ) {
        distance = Math.round(haversineDistance(
          originLatitude,
          originLongitude,
          row.latitude,
          row.longitude
        ) * 10) / 10;
      } else if (distance !== null) {
        distance = Math.round(distance * 10) / 10;
      }
      return { ...row, distance };
    });

    const pagedRows = withDistance;

    // Fetch business hours for all pharmacies in the page result
    const pharmacyIds = pagedRows.map((r) => r.id);
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

    const hoursByPharmacy = new Map<number, typeof allHours>();
    for (const h of allHours) {
      const list = hoursByPharmacy.get(h.pharmacyId) ?? [];
      list.push(h);
      hoursByPharmacy.set(h.pharmacyId, list);
    }
    const specialHoursByPharmacy = new Map<number, typeof allSpecialHours>();
    for (const h of allSpecialHours) {
      const list = specialHoursByPharmacy.get(h.pharmacyId) ?? [];
      list.push(h);
      specialHoursByPharmacy.set(h.pharmacyId, list);
    }

    const now = new Date();
    const enrichedWithHours = pagedRows.map((row) => {
      const hours = hoursByPharmacy.get(row.id) ?? [];
      const specialHours = specialHoursByPharmacy.get(row.id) ?? [];
      const status = getBusinessHoursStatus(hours, specialHours, now);
      return {
        ...row,
        businessHours: hours.map(({ pharmacyId: _, ...rest }) => rest),
        businessStatus: status,
      };
    });

    res.json({
      data: enrichedWithHours,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) },
    });
  } catch (err) {
    logger.error('Pharmacies list error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬局一覧の取得に失敗しました' });
  }
});

// ── お気に入り / ブロック ──────────────────────────────
// NOTE: These routes MUST be defined before /:id to avoid route collision

router.get('/relationships', async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: pharmacyRelationships.id,
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
      relationshipType: pharmacyRelationships.relationshipType,
      createdAt: pharmacyRelationships.createdAt,
      targetPharmacyName: pharmacies.name,
    })
      .from(pharmacyRelationships)
      .innerJoin(pharmacies, eq(pharmacyRelationships.targetPharmacyId, pharmacies.id))
      .where(eq(pharmacyRelationships.pharmacyId, req.user!.id));

    res.json({
      favorites: rows.filter((r) => r.relationshipType === 'favorite'),
      blocked: rows.filter((r) => r.relationshipType === 'blocked'),
    });
  } catch (err) {
    logger.error('Relationships list error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'リレーション情報の取得に失敗しました' });
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
      .where(and(
        eq(pharmacies.id, id),
        eq(pharmacies.isActive, true),
      ))
      .limit(1);

    if (!pharmacy) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    res.json(pharmacy);
  } catch (err) {
    logger.error('Pharmacy detail error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬局情報の取得に失敗しました' });
  }
});

router.post('/:id/favorite', async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parsePositiveInt(req.params.id);
    if (!targetId) { res.status(400).json({ error: '不正なIDです' }); return; }
    if (targetId === req.user!.id) { res.status(400).json({ error: '自分自身をお気に入りに追加できません' }); return; }

    // Verify target pharmacy exists
    const [target] = await db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(and(eq(pharmacies.id, targetId), eq(pharmacies.isActive, true)))
      .limit(1);
    if (!target) { res.status(404).json({ error: '対象の薬局が見つかりません' }); return; }

    await db.insert(pharmacyRelationships).values({
      pharmacyId: req.user!.id,
      targetPharmacyId: targetId,
      relationshipType: 'favorite',
    }).onConflictDoUpdate({
      target: [pharmacyRelationships.pharmacyId, pharmacyRelationships.targetPharmacyId],
      set: {
        relationshipType: 'favorite',
        createdAt: new Date().toISOString(),
      },
    });

    res.json({ message: 'お気に入りに設定しました' });
  } catch (err) {
    logger.error('Add favorite error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'お気に入りの追加に失敗しました' });
  }
});

router.delete('/:id/favorite', async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parsePositiveInt(req.params.id);
    if (!targetId) { res.status(400).json({ error: '不正なIDです' }); return; }

    await db.delete(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, req.user!.id),
        eq(pharmacyRelationships.targetPharmacyId, targetId),
        eq(pharmacyRelationships.relationshipType, 'favorite'),
      ));
    res.json({ message: 'お気に入りを解除しました' });
  } catch (err) {
    logger.error('Remove favorite error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'お気に入りの解除に失敗しました' });
  }
});

router.post('/:id/block', async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parsePositiveInt(req.params.id);
    if (!targetId) { res.status(400).json({ error: '不正なIDです' }); return; }
    if (targetId === req.user!.id) { res.status(400).json({ error: '自分自身をブロックできません' }); return; }

    // Verify target pharmacy exists
    const [target] = await db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(and(eq(pharmacies.id, targetId), eq(pharmacies.isActive, true)))
      .limit(1);
    if (!target) { res.status(404).json({ error: '対象の薬局が見つかりません' }); return; }

    await db.insert(pharmacyRelationships).values({
      pharmacyId: req.user!.id,
      targetPharmacyId: targetId,
      relationshipType: 'blocked',
    }).onConflictDoUpdate({
      target: [pharmacyRelationships.pharmacyId, pharmacyRelationships.targetPharmacyId],
      set: {
        relationshipType: 'blocked',
        createdAt: new Date().toISOString(),
      },
    });

    res.json({ message: 'ブロックしました' });
  } catch (err) {
    logger.error('Add block error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'ブロックの追加に失敗しました' });
  }
});

router.delete('/:id/block', async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parsePositiveInt(req.params.id);
    if (!targetId) { res.status(400).json({ error: '不正なIDです' }); return; }

    await db.delete(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, req.user!.id),
        eq(pharmacyRelationships.targetPharmacyId, targetId),
        eq(pharmacyRelationships.relationshipType, 'blocked'),
      ));
    res.json({ message: 'ブロックを解除しました' });
  } catch (err) {
    logger.error('Remove block error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'ブロックの解除に失敗しました' });
  }
});

export default router;
