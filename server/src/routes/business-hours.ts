import { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacyBusinessHours, pharmacySpecialHours } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logger } from '../services/logger';

const router = Router();
router.use(requireLogin);

const DAY_NAMES = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SPECIAL_TYPES = ['holiday_closed', 'long_holiday_closed', 'temporary_closed', 'special_open'] as const;
type SpecialType = typeof SPECIAL_TYPES[number];

interface BusinessHourInput {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
}

interface SpecialHourInput {
  specialType: SpecialType;
  startDate: string;
  endDate: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
  note: string | null;
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

    if (typeof isClosed !== 'boolean' || typeof is24Hours !== 'boolean') {
      return { error: `${DAY_NAMES[dayOfWeek]}の営業フラグが不正です` };
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

function isValidDateString(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().startsWith(value);
}

function validateSpecialBusinessHours(
  specialHours: unknown,
): { valid: SpecialHourInput[]; provided: boolean } | { error: string } {
  if (specialHours === undefined) {
    return { valid: [], provided: false };
  }
  if (!Array.isArray(specialHours)) {
    return { error: '特例営業時間は配列で指定してください' };
  }
  if (specialHours.length > 120) {
    return { error: '特例営業時間は120件以内で指定してください' };
  }

  const validated: SpecialHourInput[] = [];
  for (const raw of specialHours) {
    if (typeof raw !== 'object' || raw === null) {
      return { error: '特例営業時間のフォーマットが不正です' };
    }
    const {
      specialType,
      startDate,
      endDate,
      openTime,
      closeTime,
      isClosed,
      is24Hours,
      note,
    } = raw as Record<string, unknown>;

    if (typeof specialType !== 'string' || !SPECIAL_TYPES.includes(specialType as SpecialType)) {
      return { error: '特例営業時間の種別が不正です' };
    }

    if (typeof startDate !== 'string' || !isValidDateString(startDate)) {
      return { error: '特例営業時間の開始日が不正です（YYYY-MM-DD形式）' };
    }
    if (typeof endDate !== 'string' || !isValidDateString(endDate)) {
      return { error: '特例営業時間の終了日が不正です（YYYY-MM-DD形式）' };
    }
    if (startDate > endDate) {
      return { error: '特例営業時間の開始日と終了日の順序が不正です' };
    }

    if (typeof isClosed !== 'boolean' || typeof is24Hours !== 'boolean') {
      return { error: '特例営業時間のフラグが不正です' };
    }
    if (isClosed && is24Hours) {
      return { error: '特例営業時間で休業日と24時間営業は同時に指定できません' };
    }

    if (specialType !== 'special_open') {
      if (!isClosed || is24Hours) {
        return { error: '休業系の特例営業時間は休業設定のみ指定できます' };
      }
    }

    let normalizedOpenTime: string | null = null;
    let normalizedCloseTime: string | null = null;
    if (specialType === 'special_open' && !isClosed && !is24Hours) {
      if (typeof openTime !== 'string' || !TIME_REGEX.test(openTime)) {
        return { error: '特例営業時間の開店時間が不正です（HH:MM形式）' };
      }
      if (typeof closeTime !== 'string' || !TIME_REGEX.test(closeTime)) {
        return { error: '特例営業時間の閉店時間が不正です（HH:MM形式）' };
      }
      if (openTime === closeTime) {
        return { error: '特例営業時間の開店時間と閉店時間が同じです' };
      }
      normalizedOpenTime = openTime;
      normalizedCloseTime = closeTime;
    }

    if (note !== undefined && note !== null && typeof note !== 'string') {
      return { error: '特例営業時間のメモが不正です' };
    }
    const normalizedNote = typeof note === 'string' ? note.trim() : null;
    if (normalizedNote && normalizedNote.length > 200) {
      return { error: '特例営業時間のメモは200文字以内で入力してください' };
    }

    validated.push({
      specialType: specialType as SpecialType,
      startDate,
      endDate,
      openTime: normalizedOpenTime,
      closeTime: normalizedCloseTime,
      isClosed: specialType === 'special_open' ? isClosed : true,
      is24Hours: specialType === 'special_open' ? is24Hours : false,
      note: normalizedNote || null,
    });
  }

  return { valid: validated, provided: true };
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
    logger.error('Get business hours error:', { error: (err as Error).message });
    res.status(500).json({ error: '営業時間の取得に失敗しました' });
  }
});

// Get current pharmacy's weekly + special business hours
router.get('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const [hours, specialHours] = await Promise.all([
      db.select({
        dayOfWeek: pharmacyBusinessHours.dayOfWeek,
        openTime: pharmacyBusinessHours.openTime,
        closeTime: pharmacyBusinessHours.closeTime,
        isClosed: pharmacyBusinessHours.isClosed,
        is24Hours: pharmacyBusinessHours.is24Hours,
      })
        .from(pharmacyBusinessHours)
        .where(eq(pharmacyBusinessHours.pharmacyId, req.user!.id))
        .orderBy(pharmacyBusinessHours.dayOfWeek),
      db.select({
        id: pharmacySpecialHours.id,
        specialType: pharmacySpecialHours.specialType,
        startDate: pharmacySpecialHours.startDate,
        endDate: pharmacySpecialHours.endDate,
        openTime: pharmacySpecialHours.openTime,
        closeTime: pharmacySpecialHours.closeTime,
        isClosed: pharmacySpecialHours.isClosed,
        is24Hours: pharmacySpecialHours.is24Hours,
        note: pharmacySpecialHours.note,
      })
        .from(pharmacySpecialHours)
        .where(eq(pharmacySpecialHours.pharmacyId, req.user!.id))
        .orderBy(pharmacySpecialHours.startDate, pharmacySpecialHours.endDate, pharmacySpecialHours.id),
    ]);

    res.json({
      hours,
      specialHours,
    });
  } catch (err) {
    logger.error('Get business hour settings error:', { error: (err as Error).message });
    res.status(500).json({ error: '営業時間設定の取得に失敗しました' });
  }
});

// Set/update current pharmacy's business hours
router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const weeklyResult = validateBusinessHours(req.body.hours);
    if ('error' in weeklyResult) {
      res.status(400).json({ error: weeklyResult.error });
      return;
    }

    const specialResult = validateSpecialBusinessHours(req.body.specialHours);
    if ('error' in specialResult) {
      res.status(400).json({ error: specialResult.error });
      return;
    }

    // Atomic: delete + insert within a transaction
    await db.transaction(async (tx) => {
      await tx.delete(pharmacyBusinessHours)
        .where(eq(pharmacyBusinessHours.pharmacyId, req.user!.id));

      await tx.insert(pharmacyBusinessHours).values(
        weeklyResult.valid.map((h) => ({
          pharmacyId: req.user!.id,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
          is24Hours: h.is24Hours,
        }))
      );

      if (specialResult.provided) {
        await tx.delete(pharmacySpecialHours)
          .where(eq(pharmacySpecialHours.pharmacyId, req.user!.id));

        if (specialResult.valid.length > 0) {
          await tx.insert(pharmacySpecialHours).values(
            specialResult.valid.map((h) => ({
              pharmacyId: req.user!.id,
              specialType: h.specialType,
              startDate: h.startDate,
              endDate: h.endDate,
              openTime: h.openTime,
              closeTime: h.closeTime,
              isClosed: h.isClosed,
              is24Hours: h.is24Hours,
              note: h.note,
              updatedAt: new Date().toISOString(),
            })),
          );
        }
      }
    });

    res.json({ message: '営業時間を更新しました' });
  } catch (err) {
    logger.error('Update business hours error:', { error: (err as Error).message });
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
    logger.error('Get pharmacy business hours error:', { error: (err as Error).message });
    res.status(500).json({ error: '営業時間の取得に失敗しました' });
  }
});

export default router;
