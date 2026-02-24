import { Router, Response } from 'express';
import { and, eq, or, like, desc, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, pharmacyBusinessHours, pharmacySpecialHours, pharmacyRelationships } from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { requireLogin } from '../middleware/auth';
import { haversineDistance } from '../utils/geo-utils';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, parsePositiveInt, escapeLikeWildcards } from '../utils/request-utils';
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
      const nameConditions = likeTerms.map((term) => like(pharmacies.name, `%${escapeLikeWildcards(term)}%`));
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
    const enrichedWithHours = enriched.map((row) => {
      const hours = hoursByPharmacy.get(row.id) ?? [];
      const specialHours = specialHoursByPharmacy.get(row.id) ?? [];
      const status = getBusinessHoursStatus(hours, specialHours, now);
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

// ── お気に入り / ブロック ──────────────────────────────
// NOTE: These routes MUST be defined before /:id to avoid route collision

router.get('/relationships', async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: pharmacyRelationships.id,
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
      relationshipType: pharmacyRelationships.relationshipType,
      createdAt: pharmacyRelationships.createdAt,
    })
      .from(pharmacyRelationships)
      .where(eq(pharmacyRelationships.pharmacyId, req.user!.id));

    // Enrich with pharmacy names
    const targetIds = rows.map((r) => r.targetPharmacyId);
    const pharmacyNames = targetIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
          .from(pharmacies)
          .where(inArray(pharmacies.id, targetIds))
      : [];
    const nameMap = new Map(pharmacyNames.map((p) => [p.id, p.name]));

    const enriched = rows.map((r) => ({
      ...r,
      targetPharmacyName: nameMap.get(r.targetPharmacyId) ?? '不明',
    }));

    res.json({
      favorites: enriched.filter((r) => r.relationshipType === 'favorite'),
      blocked: enriched.filter((r) => r.relationshipType === 'blocked'),
    });
  } catch (err) {
    console.error('Relationships list error:', err);
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

    // Check if a relationship already exists
    const [existing] = await db.select()
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, req.user!.id),
        eq(pharmacyRelationships.targetPharmacyId, targetId),
      ))
      .limit(1);

    if (existing) {
      if (existing.relationshipType === 'favorite') {
        res.json({ message: '既にお気に入りに追加済みです' });
        return;
      }
      // Switch from blocked to favorite
      await db.update(pharmacyRelationships)
        .set({ relationshipType: 'favorite' })
        .where(eq(pharmacyRelationships.id, existing.id));
      res.json({ message: 'お気に入りに変更しました' });
      return;
    }

    await db.insert(pharmacyRelationships).values({
      pharmacyId: req.user!.id,
      targetPharmacyId: targetId,
      relationshipType: 'favorite',
    });
    res.json({ message: 'お気に入りに追加しました' });
  } catch (err) {
    console.error('Add favorite error:', err);
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
    console.error('Remove favorite error:', err);
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

    const [existing] = await db.select()
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, req.user!.id),
        eq(pharmacyRelationships.targetPharmacyId, targetId),
      ))
      .limit(1);

    if (existing) {
      if (existing.relationshipType === 'blocked') {
        res.json({ message: '既にブロック済みです' });
        return;
      }
      // Switch from favorite to blocked
      await db.update(pharmacyRelationships)
        .set({ relationshipType: 'blocked' })
        .where(eq(pharmacyRelationships.id, existing.id));
      res.json({ message: 'ブロックしました' });
      return;
    }

    await db.insert(pharmacyRelationships).values({
      pharmacyId: req.user!.id,
      targetPharmacyId: targetId,
      relationshipType: 'blocked',
    });
    res.json({ message: 'ブロックしました' });
  } catch (err) {
    console.error('Add block error:', err);
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
    console.error('Remove block error:', err);
    res.status(500).json({ error: 'ブロックの解除に失敗しました' });
  }
});

export default router;
