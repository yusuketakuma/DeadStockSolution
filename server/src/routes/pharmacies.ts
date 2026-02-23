import { Router, Response } from 'express';
import { eq, like, count, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { haversineDistance } from '../utils/geo-utils';
import { AuthRequest } from '../types';

const router = Router();
router.use(requireLogin);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const prefecture = req.query.prefecture as string | undefined;
    const sortBy = req.query.sortBy as string | undefined;

    // Get current pharmacy coordinates for distance calculation
    const [currentPharmacy] = await db.select({
      latitude: pharmacies.latitude,
      longitude: pharmacies.longitude,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);

    let query = db.select({
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
      .where(eq(pharmacies.isActive, true))
      .orderBy(desc(pharmacies.createdAt))
      .limit(limit)
      .offset(offset);

    if (search) {
      query = db.select({
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
        .where(like(pharmacies.name, `%${search}%`))
        .orderBy(desc(pharmacies.createdAt))
        .limit(limit)
        .offset(offset);
    }

    let rows = await query;

    // Enrich with distance
    const enriched = rows.map((row) => {
      let distance: number | null = null;
      if (currentPharmacy?.latitude && currentPharmacy?.longitude && row.latitude && row.longitude) {
        distance = Math.round(
          haversineDistance(currentPharmacy.latitude, currentPharmacy.longitude, row.latitude, row.longitude) * 10
        ) / 10;
      }
      return { ...row, distance };
    });

    // Filter by prefecture
    let result = enriched;
    if (prefecture) {
      result = result.filter((r) => r.prefecture === prefecture);
    }

    // Sort by distance if requested
    if (sortBy === 'distance') {
      result.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
    }

    const [total] = await db.select({ count: count() }).from(pharmacies).where(eq(pharmacies.isActive, true));

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
    const id = parseInt(req.params.id as string);
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
