import { Router, Response } from 'express';
import { and, eq, like, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { haversineDistance } from '../utils/geo-utils';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, parsePositiveInt } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';

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
      conditions.push(like(pharmacies.name, `%${search}%`));
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

    let result = enriched;

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
