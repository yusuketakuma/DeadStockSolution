import { Router, Response } from 'express';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  pharmacyBusinessHours,
  pharmacySpecialHours,
} from '../db/schema';
import { invalidateAuthUserCache } from '../middleware/auth';
import { processVerificationCallback } from '../services/pharmacy-verification-callback-service';
import {
  detectChangedReverificationFields,
  ReverificationTriggerError,
  sendReverificationTriggerErrorResponse,
  triggerReverification,
} from '../services/pharmacy-verification-service';
import { AuthRequest } from '../types';
import { geocodeAddress } from '../services/geocode-service';
import { writeLog, getClientIp } from '../services/log-service';
import { emailSchema } from '../utils/validators';
import { eqEmailCaseInsensitive } from '../utils/email-utils';
import { fetchBusinessHourSettings, validateBusinessHours, validateSpecialBusinessHours } from './business-hours';
import { adminWriteLimiter } from './admin-write-limiter';
import { parseIdOrBadRequest, handleAdminError } from './admin-utils';

function isValidVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 2_147_483_647;
}

type InputValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type PharmacyUpdatePreparationResult =
  | { ok: true; value: PharmacyUpdatePayload }
  | { ok: false; status: 400 | 409; error: string };

type PharmacyUpdatePayload = Partial<{
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  isActive: boolean;
  isTestAccount: boolean;
  testAccountPassword: string | null;
  latitude: number;
  longitude: number;
  updatedAt: string;
  version: number | SQL;
}>;

const PHARMACY_NOT_FOUND_ERROR = '薬局が見つかりません';
const INVALID_VERSION_ERROR = 'バージョン情報が不正です';
const OPTIMISTIC_LOCK_CONFLICT_ERROR = '他のデバイスまたはタブで更新されています。最新データを確認してください';

const pharmacyUpdateSelection = {
  id: pharmacies.id,
  email: pharmacies.email,
  name: pharmacies.name,
  postalCode: pharmacies.postalCode,
  address: pharmacies.address,
  phone: pharmacies.phone,
  fax: pharmacies.fax,
  licenseNumber: pharmacies.licenseNumber,
  prefecture: pharmacies.prefecture,
  isTestAccount: pharmacies.isTestAccount,
  testAccountPassword: pharmacies.testAccountPassword,
  verificationRequestId: pharmacies.verificationRequestId,
};

const pharmacyConflictSelection = {
  ...pharmacyUpdateSelection,
  isActive: pharmacies.isActive,
  verificationStatus: pharmacies.verificationStatus,
  version: pharmacies.version,
};

async function fetchPharmacyForUpdate(id: number) {
  const rows = await db.select(pharmacyUpdateSelection)
    .from(pharmacies)
    .where(eq(pharmacies.id, id))
    .limit(1);

  return rows[0] ?? null;
}

async function fetchLatestPharmacyConflict(id: number) {
  const rows = await db.select(pharmacyConflictSelection)
    .from(pharmacies)
    .where(eq(pharmacies.id, id))
    .limit(1);

  return rows[0] ?? null;
}

type PharmacyUpdateCurrent = NonNullable<Awaited<ReturnType<typeof fetchPharmacyForUpdate>>>;

async function pharmacyExists(id: number): Promise<boolean> {
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.id, id))
    .limit(1);

  return rows.length > 0;
}

async function findPharmacyIdByEmail(email: string): Promise<number | null> {
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eqEmailCaseInsensitive(pharmacies.email, email))
    .limit(1);

  return rows[0]?.id ?? null;
}

async function findPharmacyIdByLicenseNumber(licenseNumber: string): Promise<number | null> {
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.licenseNumber, licenseNumber))
    .limit(1);

  return rows[0]?.id ?? null;
}

function sendPharmacyNotFound(res: Response) {
  res.status(404).json({ error: PHARMACY_NOT_FOUND_ERROR });
}

function sendOptimisticLockConflict(res: Response, latestData: unknown) {
  res.status(409).json({
    error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
    latestData,
  });
}

function parseVersionOrSendError(res: Response, value: unknown): number | null {
  if (!isValidVersion(value)) {
    res.status(400).json({ error: INVALID_VERSION_ERROR });
    return null;
  }

  return value;
}

function setEmailUpdate(updates: PharmacyUpdatePayload, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    return 'メールアドレスが不正です';
  }

  const normalizedEmail = value.trim().toLowerCase();
  const parsedEmail = emailSchema.safeParse(normalizedEmail);
  if (!parsedEmail.success) {
    return parsedEmail.error.issues[0]?.message ?? 'メールアドレスが不正です';
  }

  updates.email = normalizedEmail;
  return null;
}

function setTrimmedStringUpdate(
  updates: PharmacyUpdatePayload,
  key: 'name' | 'address' | 'phone' | 'fax' | 'licenseNumber' | 'prefecture',
  value: unknown,
  maxLength: number,
  error: string,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    return error;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0 || normalizedValue.length > maxLength) {
    return error;
  }

  updates[key] = normalizedValue;
  return null;
}

function setPostalCodeUpdate(updates: PharmacyUpdatePayload, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    return '郵便番号が不正です';
  }

  const normalizedPostalCode = value.replace(/[-ー－\s]/g, '');
  if (!/^\d{7}$/.test(normalizedPostalCode)) {
    return '郵便番号は7桁の数字で入力してください';
  }

  updates.postalCode = normalizedPostalCode;
  return null;
}

function setBooleanUpdate(
  updates: PharmacyUpdatePayload,
  key: 'isActive' | 'isTestAccount',
  value: unknown,
  error: string,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'boolean') {
    return error;
  }

  updates[key] = value;
  return null;
}

function setTestAccountPasswordUpdate(updates: PharmacyUpdatePayload, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    return 'テストアカウントの表示用パスワードが不正です';
  }

  const normalizedTestAccountPassword = value.trim();
  if (normalizedTestAccountPassword.length > 100) {
    return 'テストアカウントの表示用パスワードは100文字以内で入力してください';
  }

  updates.testAccountPassword = normalizedTestAccountPassword.length === 0
    ? null
    : normalizedTestAccountPassword;
  return null;
}

function buildPharmacyUpdatePayload(body: Record<string, unknown>): InputValidationResult<PharmacyUpdatePayload> {
  const updates: PharmacyUpdatePayload = {};

  const emailError = setEmailUpdate(updates, body.email);
  if (emailError) return { ok: false, error: emailError };

  const nameError = setTrimmedStringUpdate(updates, 'name', body.name, 100, '薬局名は1〜100文字で入力してください');
  if (nameError) return { ok: false, error: nameError };

  const postalCodeError = setPostalCodeUpdate(updates, body.postalCode);
  if (postalCodeError) return { ok: false, error: postalCodeError };

  const addressError = setTrimmedStringUpdate(updates, 'address', body.address, 255, '住所は1〜255文字で入力してください');
  if (addressError) return { ok: false, error: addressError };

  const phoneError = setTrimmedStringUpdate(updates, 'phone', body.phone, 30, '電話番号が不正です');
  if (phoneError) return { ok: false, error: phoneError };

  const faxError = setTrimmedStringUpdate(updates, 'fax', body.fax, 30, 'FAX番号が不正です');
  if (faxError) return { ok: false, error: faxError };

  const licenseNumberError = setTrimmedStringUpdate(updates, 'licenseNumber', body.licenseNumber, 50, '薬局開設許可番号が不正です');
  if (licenseNumberError) return { ok: false, error: licenseNumberError };

  const prefectureError = setTrimmedStringUpdate(updates, 'prefecture', body.prefecture, 10, '都道府県が不正です');
  if (prefectureError) return { ok: false, error: prefectureError };

  const isActiveError = setBooleanUpdate(updates, 'isActive', body.isActive, '有効状態フラグが不正です');
  if (isActiveError) return { ok: false, error: isActiveError };

  const isTestAccountError = setBooleanUpdate(updates, 'isTestAccount', body.isTestAccount, 'テストアカウントフラグが不正です');
  if (isTestAccountError) return { ok: false, error: isTestAccountError };

  const testAccountPasswordError = setTestAccountPasswordUpdate(updates, body.testAccountPassword);
  if (testAccountPasswordError) return { ok: false, error: testAccountPasswordError };

  return { ok: true, value: updates };
}

async function ensureUniquePharmacyUpdates(
  id: number,
  updates: PharmacyUpdatePayload,
): Promise<string | null> {
  if (typeof updates.email === 'string') {
    const existingEmailId = await findPharmacyIdByEmail(updates.email);
    if (existingEmailId !== null && existingEmailId !== id) {
      return 'このメールアドレスは既に登録されています';
    }
  }

  if (typeof updates.licenseNumber === 'string') {
    const existingLicenseId = await findPharmacyIdByLicenseNumber(updates.licenseNumber);
    if (existingLicenseId !== null && existingLicenseId !== id) {
      return 'この薬局開設許可番号は既に登録されています';
    }
  }

  return null;
}

async function applyGeocodedCoordinates(
  current: PharmacyUpdateCurrent,
  updates: PharmacyUpdatePayload,
): Promise<string | null> {
  if (updates.address === undefined && updates.prefecture === undefined) {
    return null;
  }

  const nextPrefecture = updates.prefecture ?? current.prefecture;
  const nextAddress = updates.address ?? current.address;
  const coords = await geocodeAddress(`${nextPrefecture}${nextAddress}`);
  if (!coords) {
    return '住所から位置情報を特定できませんでした。正しい住所を入力してください';
  }

  updates.latitude = coords.lat;
  updates.longitude = coords.lng;
  return null;
}

function finalizeTestAccountUpdate(
  current: PharmacyUpdateCurrent,
  updates: PharmacyUpdatePayload,
): string | null {
  const nextIsTestAccount = updates.isTestAccount ?? current.isTestAccount;
  const nextTestAccountPassword = updates.testAccountPassword !== undefined
    ? updates.testAccountPassword
    : current.testAccountPassword;

  if (nextIsTestAccount) {
    if (typeof nextTestAccountPassword !== 'string' || nextTestAccountPassword.trim().length === 0) {
      return 'テストアカウントには表示用パスワードを設定してください';
    }
    return null;
  }

  updates.testAccountPassword = null;
  return null;
}

async function preparePharmacyUpdatePayload(
  id: number,
  current: PharmacyUpdateCurrent,
  body: Record<string, unknown>,
): Promise<PharmacyUpdatePreparationResult> {
  const parsed = buildPharmacyUpdatePayload(body);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const updates = parsed.value;

  const uniqueUpdateError = await ensureUniquePharmacyUpdates(id, updates);
  if (uniqueUpdateError) {
    return { ok: false, status: 409, error: uniqueUpdateError };
  }

  const geocodeError = await applyGeocodedCoordinates(current, updates);
  if (geocodeError) {
    return { ok: false, status: 400, error: geocodeError };
  }

  const testAccountError = finalizeTestAccountUpdate(current, updates);
  if (testAccountError) {
    return { ok: false, status: 400, error: testAccountError };
  }

  return { ok: true, value: updates };
}

const router = Router();

router.get('/pharmacies/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const rows = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      sendPharmacyNotFound(res);
      return;
    }

    const { passwordHash: _, ...pharmacy } = rows[0];
    res.json(pharmacy);
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy detail error', '薬局情報の取得に失敗しました', res);
  }
});

router.get('/pharmacies/:id/business-hours/settings', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const data = await fetchBusinessHourSettings(id);
    res.json(data);
  } catch (err) {
    if (err instanceof Error && err.message === PHARMACY_NOT_FOUND_ERROR) {
      sendPharmacyNotFound(res);
      return;
    }
    handleAdminError(err, 'Admin pharmacy business hour settings error', '営業時間設定の取得に失敗しました', res);
  }
});

router.put('/pharmacies/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  let latestVersion: number | null = null;
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const body = req.body as Record<string, unknown>;
    const version = parseVersionOrSendError(res, body.version);
    if (version === null) return;

    const current = await fetchPharmacyForUpdate(id);
    if (!current) {
      sendPharmacyNotFound(res);
      return;
    }

    const preparedUpdates = await preparePharmacyUpdatePayload(id, current, body);
    if (!preparedUpdates.ok) {
      res.status(preparedUpdates.status).json({ error: preparedUpdates.error });
      return;
    }

    const updates = preparedUpdates.value;
    const changedReverificationFields = detectChangedReverificationFields(current, updates);
    const hasReverificationField = changedReverificationFields.length > 0;

    updates.updatedAt = new Date().toISOString();
    updates.version = sql`${pharmacies.version} + 1`;

    const updateResult = await db.update(pharmacies)
      .set(updates)
      .where(and(eq(pharmacies.id, id), eq(pharmacies.version, version)))
      .returning({
        id: pharmacies.id,
        version: pharmacies.version,
      });

    if (updateResult.length === 0) {
      const latestData = await fetchLatestPharmacyConflict(id);
      if (!latestData) {
        sendPharmacyNotFound(res);
        return;
      }
      sendOptimisticLockConflict(res, latestData);
      return;
    }

    latestVersion = updateResult[0]?.version ?? null;
    invalidateAuthUserCache(id);

    // 再認証トリガー: 対象フィールドが実際に変更された場合（isActive/isTestAccount 変更は対象外）
    if (hasReverificationField) {
      await triggerReverification(id, changedReverificationFields, {
        currentVerificationRequestId: current.verificationRequestId,
        triggeredBy: 'admin',
      });
    }

    void writeLog('account_update', {
      pharmacyId: req.user!.id,
      detail: hasReverificationField
        ? `管理者が薬局ID:${id}の基本情報を更新（再認証トリガー）`
        : `管理者が薬局ID:${id}の基本情報を更新`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '薬局情報を更新しました', version: updateResult[0].version });
  } catch (err) {
    if (err instanceof ReverificationTriggerError) {
      sendReverificationTriggerErrorResponse(
        res,
        '薬局情報は更新されましたが、再審査依頼の登録に失敗しました。時間をおいて再試行してください。',
        latestVersion,
      );
      return;
    }
    handleAdminError(err, 'Admin pharmacy update error', '薬局情報の更新に失敗しました', res);
  }
});

router.put('/pharmacies/:id/business-hours', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

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

    const version = parseVersionOrSendError(res, req.body.version);
    if (version === null) return;

    if (!await pharmacyExists(id)) {
      sendPharmacyNotFound(res);
      return;
    }

    const result = await db.transaction(async (tx) => {
      const versionUpdate = await tx.update(pharmacies)
        .set({
          version: sql`${pharmacies.version} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(pharmacies.id, id), eq(pharmacies.version, version)))
        .returning({ version: pharmacies.version });

      if (versionUpdate.length === 0) {
        return { conflict: true as const };
      }

      await tx.delete(pharmacyBusinessHours)
        .where(eq(pharmacyBusinessHours.pharmacyId, id));

      await tx.insert(pharmacyBusinessHours).values(
        weeklyResult.valid.map((h) => ({
          pharmacyId: id,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
          is24Hours: h.is24Hours,
        })),
      );

      if (specialResult.provided) {
        await tx.delete(pharmacySpecialHours)
          .where(eq(pharmacySpecialHours.pharmacyId, id));

        if (specialResult.valid.length > 0) {
          await tx.insert(pharmacySpecialHours).values(
            specialResult.valid.map((h) => ({
              pharmacyId: id,
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

      return { conflict: false as const, newVersion: versionUpdate[0].version };
    });

    if (result.conflict) {
      const latestData = await fetchBusinessHourSettings(id);
      sendOptimisticLockConflict(res, latestData);
      return;
    }

    invalidateAuthUserCache(id);
    void writeLog('account_update', {
      pharmacyId: req.user!.id,
      detail: `管理者が薬局ID:${id}の営業時間を更新`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '営業時間を更新しました', version: result.newVersion });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy business hours update error', '営業時間の更新に失敗しました', res);
  }
});

router.put('/pharmacies/:id/toggle-active', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const rows = await db.select({ isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      sendPharmacyNotFound(res);
      return;
    }

    await db.update(pharmacies)
      .set({
        isActive: !rows[0].isActive,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, id));
    invalidateAuthUserCache(id);

    void writeLog('admin_toggle_active', {
      pharmacyId: req.user!.id,
      detail: `薬局ID:${id}を${rows[0].isActive ? '無効' : '有効'}に変更`,
      ipAddress: getClientIp(req),
    });

    res.json({ message: `薬局を${rows[0].isActive ? '無効' : '有効'}にしました` });
  } catch (err) {
    handleAdminError(err, 'Admin toggle active error', '状態変更に失敗しました', res);
  }
});

router.post('/pharmacies/:id/verify', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const { approved, reason } = req.body;
    if (typeof approved !== 'boolean') {
      res.status(400).json({ error: 'approved (boolean) を指定してください' });
      return;
    }

    const result = await processVerificationCallback({
      pharmacyId: id,
      requestId: 0, // manual verification
      approved,
      reason: reason || (approved ? '管理者による手動承認' : '管理者による手動却下'),
    });

    invalidateAuthUserCache(id);
    void writeLog('admin_verify_pharmacy', {
      pharmacyId: req.user!.id,
      detail: `管理者が薬局ID:${id}を${approved ? '承認' : '却下'}`,
      ipAddress: getClientIp(req),
    });

    res.json({
      verificationStatus: result.verificationStatus,
      pharmacyId: result.pharmacyId,
    });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy verify error', '審査処理に失敗しました', res);
  }
});

export default router;
