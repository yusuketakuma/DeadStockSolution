import { Router, Response } from 'express';
import { and, eq, or, like, desc, inArray, asc, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, pharmacyBusinessHours, pharmacySpecialHours, pharmacyRelationships } from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { groupBy } from '../utils/array-utils';
import { requireLogin } from '../middleware/auth';
import { haversineDistance } from '../utils/geo-utils';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, parsePositiveInt, escapeLikeWildcards } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import { logger } from '../services/logger';

const router = Router();
router.use(requireLogin);

type RelationshipType = 'favorite' | 'blocked';

const RELATIONSHIP_MESSAGES: Record<RelationshipType, {
  addSuccess: string;
  removeSuccess: string;
  addFailure: string;
  removeFailure: string;
  selfError: string;
  logLabel: string;
}> = {
  favorite: {
    addSuccess: 'お気に入りに設定しました',
    removeSuccess: 'お気に入りを解除しました',
    addFailure: 'お気に入りの追加に失敗しました',
    removeFailure: 'お気に入りの解除に失敗しました',
    selfError: '自分自身をお気に入りに追加できません',
    logLabel: 'favorite',
  },
  blocked: {
    addSuccess: 'ブロックしました',
    removeSuccess: 'ブロックを解除しました',
    addFailure: 'ブロックの追加に失敗しました',
    removeFailure: 'ブロックの解除に失敗しました',
    selfError: '自分自身をブロックできません',
    logLabel: 'block',
  },
};

function parseRoutePharmacyId(value: string | string[] | undefined): number | null {
  return parsePositiveInt(Array.isArray(value) ? value[0] : value);
}

async function findActivePharmacyById(id: number): Promise<{ id: number } | null> {
  const [target] = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(and(eq(pharmacies.id, id), eq(pharmacies.isActive, true)))
    .limit(1);
  return target ?? null;
}

async function upsertRelationship(
  pharmacyId: number,
  targetPharmacyId: number,
  relationshipType: RelationshipType,
): Promise<void> {
  await db.insert(pharmacyRelationships).values({
    pharmacyId,
    targetPharmacyId,
    relationshipType,
  }).onConflictDoUpdate({
    target: [pharmacyRelationships.pharmacyId, pharmacyRelationships.targetPharmacyId],
    set: {
      relationshipType,
      createdAt: new Date().toISOString(),
    },
  });
}

async function deleteRelationship(
  pharmacyId: number,
  targetPharmacyId: number,
  relationshipType: RelationshipType,
): Promise<void> {
  await db.delete(pharmacyRelationships)
    .where(and(
      eq(pharmacyRelationships.pharmacyId, pharmacyId),
      eq(pharmacyRelationships.targetPharmacyId, targetPharmacyId),
      eq(pharmacyRelationships.relationshipType, relationshipType),
    ));
}

function createRelationshipHandler(relationshipType: RelationshipType) {
  return async (req: AuthRequest, res: Response) => {
    const messages = RELATIONSHIP_MESSAGES[relationshipType];

    try {
      const targetId = parseRoutePharmacyId(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: '不正なIDです' });
        return;
      }
      if (targetId === req.user!.id) {
        res.status(400).json({ error: messages.selfError });
        return;
      }
      if (!(await findActivePharmacyById(targetId))) {
        res.status(404).json({ error: '対象の薬局が見つかりません' });
        return;
      }

      await upsertRelationship(req.user!.id, targetId, relationshipType);
      res.json({ message: messages.addSuccess });
    } catch (err) {
      logger.error(`Add ${messages.logLabel} error`, {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: messages.addFailure });
    }
  };
}

function createRelationshipDeleteHandler(relationshipType: RelationshipType) {
  return async (req: AuthRequest, res: Response) => {
    const messages = RELATIONSHIP_MESSAGES[relationshipType];

    try {
      const targetId = parseRoutePharmacyId(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: '不正なIDです' });
        return;
      }

      await deleteRelationship(req.user!.id, targetId, relationshipType);
      res.json({ message: messages.removeSuccess });
    } catch (err) {
      logger.error(`Remove ${messages.logLabel} error`, {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: messages.removeFailure });
    }
  };
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const search = normalizeSearchTerm(req.query.search);
    const prefecture = normalizeSearchTerm(req.query.prefecture, 20);
    const sortBy = req.query.sortBy === 'distance' ? 'distance' : undefined;

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

    // Fetch business hours for all pharmacies in the page result
    const pharmacyIds = withDistance.map((r) => r.id);
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
    const enrichedWithHours = withDistance.map((row) => {
      const hours = hoursByPharmacy.get(row.id) ?? [];
      const specialHours = specialHoursByPharmacy.get(row.id) ?? [];
      const status = getBusinessHoursStatus(hours, specialHours, now);
      const isConfigured = hours.length > 0 || specialHours.length > 0;
      return {
        ...row,
        businessHours: hours.map(({ pharmacyId: _, ...rest }) => rest),
        businessStatus: { ...status, isConfigured },
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
    const id = parseRoutePharmacyId(req.params.id);
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

router.post('/:id/favorite', createRelationshipHandler('favorite'));

router.delete('/:id/favorite', createRelationshipDeleteHandler('favorite'));

router.post('/:id/block', createRelationshipHandler('blocked'));

router.delete('/:id/block', createRelationshipDeleteHandler('blocked'));

export default router;
