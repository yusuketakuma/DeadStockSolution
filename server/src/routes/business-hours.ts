import { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacyBusinessHours } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(requireLogin);

const DAY_NAMES = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

interface BusinessHourInput {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
}

function validateBusinessHours(hours: unknown): { valid: BusinessHourInput[] } | { error: string } {
  if (!Array.isArray(hours)) {
    return { error: '営業時間は配列で指定してください' };
  }
  if (hours.length !== 7) {
    return { error: '7日分の営業時間を指定してください' };
  }

  const validated: BusinessHourInput[] = [];
  for (const h of hours) {
    if (typeof h !== 'object' || h === null) {
      return { error: '営業時間のフォーマットが不正です' };
    }
    const { dayOfWeek, openTime, closeTime, isClosed, is24Hours } = h as Record<string, unknown>;

    if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6 || !Number.isInteger(dayOfWeek)) {
      return { error: '曜日の値が不正です' };
    }

    // Mutual exclusion: isClosed and is24Hours cannot both be true
    if (isClosed && is24Hours) {
      return { error: `${DAY_NAMES[dayOfWeek]}の定休日と24時間営業は同時に設定できません` };
    }

    if (isClosed) {
      validated.push({ dayOfWeek, openTime: null, closeTime: null, isClosed: true, is24Hours: false });
      continue;
    }

    if (is24Hours) {
      validated.push({ dayOfWeek, openTime: null, closeTime: null, isClosed: false, is24Hours: true });
      continue;
    }

    if (typeof openTime !== 'string' || !TIME_REGEX.test(openTime)) {
      return { error: `${DAY_NAMES[dayOfWeek]}の開店時間が不正です（HH:MM形式で入力してください）` };
    }
    if (typeof closeTime !== 'string' || !TIME_REGEX.test(closeTime)) {
      return { error: `${DAY_NAMES[dayOfWeek]}の閉店時間が不正です（HH:MM形式で入力してください）` };
    }

    // openTime と closeTime が同じ場合はエラー
    if (openTime === closeTime) {
      return { error: `${DAY_NAMES[dayOfWeek]}の開店時間と閉店時間が同じです` };
    }

    validated.push({ dayOfWeek, openTime, closeTime, isClosed: false, is24Hours: false });
  }

  // Check for duplicate days
  const days = new Set(validated.map((v) => v.dayOfWeek));
  if (days.size !== 7) {
    return { error: '曜日が重複しています' };
  }

  return { valid: validated };
}

// Get current pharmacy's business hours
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const hours = await db.select({
      dayOfWeek: pharmacyBusinessHours.dayOfWeek,
      openTime: pharmacyBusinessHours.openTime,
      closeTime: pharmacyBusinessHours.closeTime,
      isClosed: pharmacyBusinessHours.isClosed,
      is24Hours: pharmacyBusinessHours.is24Hours,
    })
      .from(pharmacyBusinessHours)
      .where(eq(pharmacyBusinessHours.pharmacyId, req.user!.id))
      .orderBy(pharmacyBusinessHours.dayOfWeek);

    res.json(hours);
  } catch (err) {
    console.error('Get business hours error:', err);
    res.status(500).json({ error: '営業時間の取得に失敗しました' });
  }
});

// Set/update current pharmacy's business hours
router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = validateBusinessHours(req.body.hours);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Atomic: delete + insert within a transaction
    await db.transaction(async (tx) => {
      await tx.delete(pharmacyBusinessHours)
        .where(eq(pharmacyBusinessHours.pharmacyId, req.user!.id));

      await tx.insert(pharmacyBusinessHours).values(
        result.valid.map((h) => ({
          pharmacyId: req.user!.id,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
          is24Hours: h.is24Hours,
        }))
      );
    });

    res.json({ message: '営業時間を更新しました' });
  } catch (err) {
    console.error('Update business hours error:', err);
    res.status(500).json({ error: '営業時間の更新に失敗しました' });
  }
});

// Get another pharmacy's business hours
router.get('/:pharmacyId', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = Number(req.params.pharmacyId);
    if (!Number.isInteger(pharmacyId) || pharmacyId <= 0) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const hours = await db.select({
      dayOfWeek: pharmacyBusinessHours.dayOfWeek,
      openTime: pharmacyBusinessHours.openTime,
      closeTime: pharmacyBusinessHours.closeTime,
      isClosed: pharmacyBusinessHours.isClosed,
      is24Hours: pharmacyBusinessHours.is24Hours,
    })
      .from(pharmacyBusinessHours)
      .where(eq(pharmacyBusinessHours.pharmacyId, pharmacyId))
      .orderBy(pharmacyBusinessHours.dayOfWeek);

    res.json(hours);
  } catch (err) {
    console.error('Get pharmacy business hours error:', err);
    res.status(500).json({ error: '営業時間の取得に失敗しました' });
  }
});

export default router;
