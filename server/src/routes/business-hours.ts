import { Router, Response } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, pharmacyBusinessHours, pharmacySpecialHours } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logger } from '../services/logger';
import { invalidateBusinessHoursCacheForPharmacy } from '../services/matching/matching-data-fetcher';
import { sendBadRequest } from './response-helpers';
import { ApiError } from '../utils/api-error';
import { isRecord } from '../utils/type-guards';

const router = Router();
router.use(requireLogin);

const DAY_NAMES = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SPECIAL_TYPES = ['holiday_closed', 'long_holiday_closed', 'temporary_closed', 'special_open'] as const;
const MAX_VERSION = 2_147_483_647;
const WEEKLY_HOUR_FIELDS = {
  dayOfWeek: pharmacyBusinessHours.dayOfWeek,
  openTime: pharmacyBusinessHours.openTime,
  closeTime: pharmacyBusinessHours.closeTime,
  isClosed: pharmacyBusinessHours.isClosed,
  is24Hours: pharmacyBusinessHours.is24Hours,
} as const;
const SPECIAL_HOUR_FIELDS = {
  id: pharmacySpecialHours.id,
  specialType: pharmacySpecialHours.specialType,
  startDate: pharmacySpecialHours.startDate,
  endDate: pharmacySpecialHours.endDate,
  openTime: pharmacySpecialHours.openTime,
  closeTime: pharmacySpecialHours.closeTime,
  isClosed: pharmacySpecialHours.isClosed,
  is24Hours: pharmacySpecialHours.is24Hours,
  note: pharmacySpecialHours.note,
} as const;
type SpecialType = typeof SPECIAL_TYPES[number];
type WeeklyBusinessHourRow = Pick<
  typeof pharmacyBusinessHours.$inferSelect,
  'dayOfWeek' | 'openTime' | 'closeTime' | 'isClosed' | 'is24Hours'
>;
type SpecialBusinessHourRow = Pick<
  typeof pharmacySpecialHours.$inferSelect,
  'id' | 'specialType' | 'startDate' | 'endDate' | 'openTime' | 'closeTime' | 'isClosed' | 'is24Hours' | 'note'
>;
type WeeklyBusinessHourValue = Pick<
  typeof pharmacyBusinessHours.$inferInsert,
  'pharmacyId' | 'dayOfWeek' | 'openTime' | 'closeTime' | 'isClosed' | 'is24Hours'
>;
type SpecialBusinessHourValue = Pick<
  typeof pharmacySpecialHours.$inferInsert,
  'pharmacyId' | 'specialType' | 'startDate' | 'endDate' | 'openTime' | 'closeTime' | 'isClosed' | 'is24Hours' | 'note' | 'updatedAt'
>;
type BusinessHoursSettings = {
  hours: WeeklyBusinessHourRow[];
  specialHours: SpecialBusinessHourRow[];
  version: number;
};
type BusinessHoursUpdatePayload = {
  weekly: BusinessHourInput[];
  special: SpecialHourInput[];
  specialProvided: boolean;
  version: number;
};
type RouteHandler = (req: AuthRequest, res: Response) => Promise<void>;

export interface BusinessHourInput {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
}

export interface SpecialHourInput {
  specialType: SpecialType;
  startDate: string;
  endDate: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
  note: string | null;
}

function validateTimeRange(
  openTime: unknown,
  closeTime: unknown,
  invalidOpenMessage: string,
  invalidCloseMessage: string,
  sameTimeMessage: string,
): { openTime: string; closeTime: string } | { error: string } {
  if (typeof openTime !== 'string' || !TIME_REGEX.test(openTime)) {
    return { error: invalidOpenMessage };
  }
  if (typeof closeTime !== 'string' || !TIME_REGEX.test(closeTime)) {
    return { error: invalidCloseMessage };
  }
  if (openTime === closeTime) {
    return { error: sameTimeMessage };
  }
  return { openTime, closeTime };
}


function isSpecialType(value: unknown): value is SpecialType {
  return typeof value === 'string' && SPECIAL_TYPES.some((specialType) => specialType === value);
}

function isValidVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_VERSION;
}

function parsePositiveInteger(value: unknown): number | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = typeof normalized === 'string' ? Number(normalized) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchWeeklyBusinessHours(pharmacyId: number): Promise<WeeklyBusinessHourRow[]> {
  return db.select(WEEKLY_HOUR_FIELDS)
    .from(pharmacyBusinessHours)
    .where(eq(pharmacyBusinessHours.pharmacyId, pharmacyId))
    .orderBy(pharmacyBusinessHours.dayOfWeek);
}

async function fetchSpecialBusinessHours(pharmacyId: number): Promise<SpecialBusinessHourRow[]> {
  return db.select(SPECIAL_HOUR_FIELDS)
    .from(pharmacySpecialHours)
    .where(eq(pharmacySpecialHours.pharmacyId, pharmacyId))
    .orderBy(pharmacySpecialHours.startDate, pharmacySpecialHours.endDate, pharmacySpecialHours.id);
}

function buildWeeklyBusinessHourValues(pharmacyId: number, hours: BusinessHourInput[]): WeeklyBusinessHourValue[] {
  return hours.map((hour) => ({
    pharmacyId,
    dayOfWeek: hour.dayOfWeek,
    openTime: hour.openTime,
    closeTime: hour.closeTime,
    isClosed: hour.isClosed,
    is24Hours: hour.is24Hours,
  }));
}

function buildSpecialBusinessHourValues(
  pharmacyId: number,
  hours: SpecialHourInput[],
  updatedAt: string,
): SpecialBusinessHourValue[] {
  return hours.map((hour) => ({
    pharmacyId,
    specialType: hour.specialType,
    startDate: hour.startDate,
    endDate: hour.endDate,
    openTime: hour.openTime,
    closeTime: hour.closeTime,
    isClosed: hour.isClosed,
    is24Hours: hour.is24Hours,
    note: hour.note,
    updatedAt,
  }));
}

export function validateBusinessHours(hours: unknown): { valid: BusinessHourInput[] } | { error: string } {
  if (!Array.isArray(hours)) {
    return { error: '営業時間は配列で指定してください' };
  }
  if (hours.length !== 7) {
    return { error: '7日分の営業時間を指定してください' };
  }

  const validated: BusinessHourInput[] = [];
  for (const raw of hours) {
    const validation = validateBusinessHourEntry(raw);
    if ('error' in validation) {
      return validation;
    }
    validated.push(validation);
  }

  // Check for duplicate days
  const days = new Set(validated.map((v) => v.dayOfWeek));
  if (days.size !== 7) {
    return { error: '曜日が重複しています' };
  }

  return { valid: validated };
}

function validateBusinessHourEntry(raw: unknown): BusinessHourInput | { error: string } {
  const entry = isRecord(raw) ? raw : null;
  if (!entry) {
    return { error: '営業時間のフォーマットが不正です' };
  }

  const dayOfWeek = entry.dayOfWeek;
  if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6 || !Number.isInteger(dayOfWeek)) {
    return { error: '曜日の値が不正です' };
  }

  const dayName = DAY_NAMES[dayOfWeek];
  const isClosed = entry.isClosed;
  const is24Hours = entry.is24Hours;
  if (typeof isClosed !== 'boolean' || typeof is24Hours !== 'boolean') {
    return { error: `${dayName}の営業フラグが不正です` };
  }

  if (isClosed && is24Hours) {
    return { error: `${dayName}の定休日と24時間営業は同時に設定できません` };
  }

  if (isClosed) {
    return { dayOfWeek, openTime: null, closeTime: null, isClosed: true, is24Hours: false };
  }

  if (is24Hours) {
    return { dayOfWeek, openTime: null, closeTime: null, isClosed: false, is24Hours: true };
  }

  const timeRange = validateTimeRange(
    entry.openTime,
    entry.closeTime,
    `${dayName}の開店時間が不正です（HH:MM形式で入力してください）`,
    `${dayName}の閉店時間が不正です（HH:MM形式で入力してください）`,
    `${dayName}の開店時間と閉店時間が同じです`,
  );
  if ('error' in timeRange) {
    return timeRange;
  }

  return {
    dayOfWeek,
    openTime: timeRange.openTime,
    closeTime: timeRange.closeTime,
    isClosed: false,
    is24Hours: false,
  };
}

function isValidDateString(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().startsWith(value);
}

export function validateSpecialBusinessHours(
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
    const entryResult = validateSpecialBusinessHourEntry(raw);
    if ('error' in entryResult) {
      return entryResult;
    }
    validated.push(entryResult);
  }

  return { valid: validated, provided: true };
}

function validateSpecialBusinessHourEntry(raw: unknown): SpecialHourInput | { error: string } {
  const entry = isRecord(raw) ? raw : null;
  if (!entry) {
    return { error: '特例営業時間のフォーマットが不正です' };
  }

  if (!isSpecialType(entry.specialType)) {
    return { error: '特例営業時間の種別が不正です' };
  }
  const specialType = entry.specialType;

  const startDate = entry.startDate;
  if (typeof startDate !== 'string' || !isValidDateString(startDate)) {
    return { error: '特例営業時間の開始日が不正です（YYYY-MM-DD形式）' };
  }

  const endDate = entry.endDate;
  if (typeof endDate !== 'string' || !isValidDateString(endDate)) {
    return { error: '特例営業時間の終了日が不正です（YYYY-MM-DD形式）' };
  }
  if (startDate > endDate) {
    return { error: '特例営業時間の開始日と終了日の順序が不正です' };
  }

  const isClosed = entry.isClosed;
  const is24Hours = entry.is24Hours;
  if (typeof isClosed !== 'boolean' || typeof is24Hours !== 'boolean') {
    return { error: '特例営業時間のフラグが不正です' };
  }
  if (isClosed && is24Hours) {
    return { error: '特例営業時間で休業日と24時間営業は同時に指定できません' };
  }

  if (specialType !== 'special_open' && (!isClosed || is24Hours)) {
    return { error: '休業系の特例営業時間は休業設定のみ指定できます' };
  }

  let normalizedOpenTime: string | null = null;
  let normalizedCloseTime: string | null = null;
  if (specialType === 'special_open' && !isClosed && !is24Hours) {
    const timeRange = validateTimeRange(
      entry.openTime,
      entry.closeTime,
      '特例営業時間の開店時間が不正です（HH:MM形式）',
      '特例営業時間の閉店時間が不正です（HH:MM形式）',
      '特例営業時間の開店時間と閉店時間が同じです',
    );
    if ('error' in timeRange) {
      return timeRange;
    }
    normalizedOpenTime = timeRange.openTime;
    normalizedCloseTime = timeRange.closeTime;
  }

  const normalizedNoteResult = normalizeSpecialNote(entry.note);
  if ('error' in normalizedNoteResult) {
    return normalizedNoteResult;
  }

  return {
    specialType,
    startDate,
    endDate,
    openTime: normalizedOpenTime,
    closeTime: normalizedCloseTime,
    isClosed: specialType === 'special_open' ? isClosed : true,
    is24Hours: specialType === 'special_open' ? is24Hours : false,
    note: normalizedNoteResult.note,
  };
}

function normalizeSpecialNote(note: unknown): { note: string | null } | { error: string } {
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return { error: '特例営業時間のメモが不正です' };
  }

  const normalizedNote = typeof note === 'string' ? note.trim() : null;
  if (normalizedNote && normalizedNote.length > 200) {
    return { error: '特例営業時間のメモは200文字以内で入力してください' };
  }

  return { note: normalizedNote || null };
}

function unwrapSettled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') {
    throw result.reason;
  }
  return result.value;
}

function parseBusinessHoursUpdatePayload(
  body: Record<string, unknown>,
): BusinessHoursUpdatePayload | { error: string } {
  const weeklyResult = validateBusinessHours(body.hours);
  if ('error' in weeklyResult) {
    return { error: weeklyResult.error };
  }

  const specialResult = validateSpecialBusinessHours(body.specialHours);
  if ('error' in specialResult) {
    return { error: specialResult.error };
  }

  const version = body.version;
  if (!isValidVersion(version)) {
    return { error: 'バージョン情報が不正です' };
  }

  return {
    weekly: weeklyResult.valid,
    special: specialResult.valid,
    specialProvided: specialResult.provided,
    version,
  };
}

/**
 * 指定薬局の営業時間設定（週次 + 特例 + version）を取得する共通関数。
 * GET /settings と PUT / の 409 conflict レスポンスの両方で使用する。
 * NOTE: version は pharmacies テーブルの version を共用しており、
 * アカウント情報更新でも version がインクリメントされるため、
 * 営業時間以外の変更でも 409 が発生しうる（意図的な設計）。
 */
export async function fetchBusinessHourSettings(pharmacyId: number): Promise<BusinessHoursSettings> {
  const [hoursResult, specialHoursRowsResult, pharmacyRowsResult] = await Promise.allSettled([
    fetchWeeklyBusinessHours(pharmacyId),
    fetchSpecialBusinessHours(pharmacyId),
    db.select({ version: pharmacies.version })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1),
  ]);
  const hours = unwrapSettled(hoursResult);
  const specialHoursRows = unwrapSettled(specialHoursRowsResult);
  const pharmacyRows = unwrapSettled(pharmacyRowsResult);

  if (pharmacyRows.length === 0) {
    throw new ApiError(404, '薬局が見つかりません', 'NOT_FOUND');
  }

  return {
    hours,
    specialHours: specialHoursRows,
    version: pharmacyRows[0].version,
  };
}

function getCurrentPharmacyId(req: AuthRequest): number {
  return req.user!.id;
}

function handleRouteError(errorLogMessage: string, responseErrorMessage: string, err: unknown, res: Response): void {
  const errorMessage = err instanceof Error ? err.message : String(err);
  logger.error(errorLogMessage, { error: errorMessage });
  res.status(500).json({ error: responseErrorMessage });
}

function withRouteErrorHandling(
  errorLogMessage: string,
  responseErrorMessage: string,
  handler: RouteHandler,
): RouteHandler {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (err) {
      handleRouteError(errorLogMessage, responseErrorMessage, err, res);
    }
  };
}

// Get current pharmacy's business hours
const getCurrentBusinessHoursHandler: RouteHandler = withRouteErrorHandling(
  'Get business hours error:',
  '営業時間の取得に失敗しました',
  async (req: AuthRequest, res: Response): Promise<void> => {
    const pharmacyId = getCurrentPharmacyId(req);
    res.json(await fetchWeeklyBusinessHours(pharmacyId));
  },
);
router.get('/', getCurrentBusinessHoursHandler);

// Get current pharmacy's weekly + special business hours
const getBusinessHourSettingsHandler: RouteHandler = withRouteErrorHandling(
  'Get business hour settings error:',
  '営業時間設定の取得に失敗しました',
  async (req: AuthRequest, res: Response): Promise<void> => {
    const pharmacyId = getCurrentPharmacyId(req);
    const data = await fetchBusinessHourSettings(pharmacyId);
    res.json(data);
  },
);
router.get('/settings', getBusinessHourSettingsHandler);

// Set/update current pharmacy's business hours
const updateBusinessHoursHandler: RouteHandler = withRouteErrorHandling(
  'Update business hours error:',
  '営業時間の更新に失敗しました',
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = parseBusinessHoursUpdatePayload(req.body as Record<string, unknown>);
    if ('error' in parsed) {
      sendBadRequest(res, parsed.error);
      return;
    }

    const pharmacyId = getCurrentPharmacyId(req);
    // 楽観的ロック付きトランザクション
    const result = await db.transaction(async (tx) => {
      // pharmacies テーブルの version をチェック＆インクリメント
      const versionUpdate = await tx.update(pharmacies)
        .set({
          version: sql`${pharmacies.version} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(pharmacies.id, pharmacyId), eq(pharmacies.version, parsed.version)))
        .returning({ version: pharmacies.version });

      if (versionUpdate.length === 0) {
        return { conflict: true as const };
      }

      await tx.delete(pharmacyBusinessHours)
        .where(eq(pharmacyBusinessHours.pharmacyId, pharmacyId));

      await tx.insert(pharmacyBusinessHours).values(buildWeeklyBusinessHourValues(pharmacyId, parsed.weekly));

      if (parsed.specialProvided) {
        await tx.delete(pharmacySpecialHours)
          .where(eq(pharmacySpecialHours.pharmacyId, pharmacyId));

        if (parsed.special.length > 0) {
          await tx.insert(pharmacySpecialHours).values(
            buildSpecialBusinessHourValues(pharmacyId, parsed.special, new Date().toISOString()),
          );
        }
      }

      return { conflict: false as const, newVersion: versionUpdate[0].version };
    });

    if (result.conflict) {
      // 最新の営業時間データを取得して 409 レスポンスに含める
      const latestData = await fetchBusinessHourSettings(pharmacyId);

      res.status(409).json({
        error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
        latestData,
      });
      return;
    }

    invalidateBusinessHoursCacheForPharmacy(pharmacyId);
    res.json({ message: '営業時間を更新しました', version: result.newVersion });
  },
);
router.put('/', updateBusinessHoursHandler);

// Get another pharmacy's business hours
const getOtherPharmacyBusinessHoursHandler: RouteHandler = withRouteErrorHandling(
  'Get pharmacy business hours error:',
  '営業時間の取得に失敗しました',
  async (req: AuthRequest, res: Response): Promise<void> => {
    const pharmacyId = parsePositiveInteger(req.params.pharmacyId);
    if (pharmacyId === null) {
      sendBadRequest(res, '不正なIDです');
      return;
    }

    res.json(await fetchWeeklyBusinessHours(pharmacyId));
  },
);
router.get('/:pharmacyId', getOtherPharmacyBusinessHoursHandler);

export default router;
