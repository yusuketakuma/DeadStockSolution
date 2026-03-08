import { Response } from 'express';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { emailSchema } from '../utils/validators';
import { eqEmailCaseInsensitive } from '../utils/email-utils';
import { geocodeAddress } from '../services/geocode-service';

// ============================================================================
// Types
// ============================================================================

export type InputValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type PharmacyUpdatePreparationResult =
  | { ok: true; value: PharmacyUpdatePayload }
  | { ok: false; status: 400 | 409; error: string };

export type PharmacyUpdatePayload = Partial<{
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

// ============================================================================
// Constants
// ============================================================================

export const PHARMACY_NOT_FOUND_ERROR = '薬局が見つかりません';
export const INVALID_VERSION_ERROR = 'バージョン情報が不正です';
export const OPTIMISTIC_LOCK_CONFLICT_ERROR = '他のデバイスまたはタブで更新されています。最新データを確認してください';

export const pharmacyUpdateSelection = {
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

export const pharmacyConflictSelection = {
  ...pharmacyUpdateSelection,
  isActive: pharmacies.isActive,
  verificationStatus: pharmacies.verificationStatus,
  version: pharmacies.version,
};

// ============================================================================
// Validation Functions
// ============================================================================

export function isValidVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 2_147_483_647;
}

export function parseVersionOrSendError(res: Response, value: unknown): number | null {
  if (!isValidVersion(value)) {
    res.status(400).json({ error: INVALID_VERSION_ERROR });
    return null;
  }

  return value;
}

// ============================================================================
// Field Update Setters
// ============================================================================

export function setEmailUpdate(updates: PharmacyUpdatePayload, value: unknown): string | null {
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

export function setTrimmedStringUpdate(
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

export function setPostalCodeUpdate(updates: PharmacyUpdatePayload, value: unknown): string | null {
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

export function setBooleanUpdate(
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

export function setTestAccountPasswordUpdate(updates: PharmacyUpdatePayload, value: unknown): string | null {
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

// ============================================================================
// Payload Building
// ============================================================================

export function buildPharmacyUpdatePayload(body: Record<string, unknown>): InputValidationResult<PharmacyUpdatePayload> {
  const updates: PharmacyUpdatePayload = {};
  const validators = [
    () => setEmailUpdate(updates, body.email),
    () => setTrimmedStringUpdate(updates, 'name', body.name, 100, '薬局名は1〜100文字で入力してください'),
    () => setPostalCodeUpdate(updates, body.postalCode),
    () => setTrimmedStringUpdate(updates, 'address', body.address, 255, '住所は1〜255文字で入力してください'),
    () => setTrimmedStringUpdate(updates, 'phone', body.phone, 30, '電話番号が不正です'),
    () => setTrimmedStringUpdate(updates, 'fax', body.fax, 30, 'FAX番号が不正です'),
    () => setTrimmedStringUpdate(updates, 'licenseNumber', body.licenseNumber, 50, '薬局開設許可番号が不正です'),
    () => setTrimmedStringUpdate(updates, 'prefecture', body.prefecture, 10, '都道府県が不正です'),
    () => setBooleanUpdate(updates, 'isActive', body.isActive, '有効状態フラグが不正です'),
    () => setBooleanUpdate(updates, 'isTestAccount', body.isTestAccount, 'テストアカウントフラグが不正です'),
    () => setTestAccountPasswordUpdate(updates, body.testAccountPassword),
  ];

  for (const validate of validators) {
    const error = validate();
    if (error) return { ok: false, error };
  }

  return { ok: true, value: updates };
}

// ============================================================================
// Database Queries
// ============================================================================

export async function fetchPharmacyForUpdate(id: number) {
  const rows = await db.select(pharmacyUpdateSelection)
    .from(pharmacies)
    .where(eq(pharmacies.id, id))
    .limit(1);

  return rows[0] ?? null;
}

export async function fetchLatestPharmacyConflict(id: number) {
  const rows = await db.select(pharmacyConflictSelection)
    .from(pharmacies)
    .where(eq(pharmacies.id, id))
    .limit(1);

  return rows[0] ?? null;
}

export type PharmacyUpdateCurrent = NonNullable<Awaited<ReturnType<typeof fetchPharmacyForUpdate>>>;

export async function pharmacyExists(id: number): Promise<boolean> {
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.id, id))
    .limit(1);

  return rows.length > 0;
}

export async function findPharmacyIdByEmail(email: string): Promise<number | null> {
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eqEmailCaseInsensitive(pharmacies.email, email))
    .limit(1);

  return rows[0]?.id ?? null;
}

export async function findPharmacyIdByLicenseNumber(licenseNumber: string): Promise<number | null> {
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.licenseNumber, licenseNumber))
    .limit(1);

  return rows[0]?.id ?? null;
}

// ============================================================================
// Response Helpers
// ============================================================================

export function sendPharmacyNotFound(res: Response) {
  res.status(404).json({ error: PHARMACY_NOT_FOUND_ERROR });
}

export function sendOptimisticLockConflict(res: Response, latestData: unknown) {
  res.status(409).json({
    error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
    latestData,
  });
}

// ============================================================================
// Business Logic
// ============================================================================

export async function ensureUniquePharmacyUpdates(
  id: number,
  updates: PharmacyUpdatePayload,
): Promise<string | null> {
  const uniqueChecks = [
    typeof updates.email === 'string'
      ? {
        value: updates.email,
        findExistingId: findPharmacyIdByEmail,
        error: 'このメールアドレスは既に登録されています',
      }
      : null,
    typeof updates.licenseNumber === 'string'
      ? {
        value: updates.licenseNumber,
        findExistingId: findPharmacyIdByLicenseNumber,
        error: 'この薬局開設許可番号は既に登録されています',
      }
      : null,
  ];

  for (const check of uniqueChecks) {
    if (!check) continue;
    const existingId = await check.findExistingId(check.value);
    if (existingId !== null && existingId !== id) {
      return check.error;
    }
  }

  return null;
}

export async function applyGeocodedCoordinates(
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

export function finalizeTestAccountUpdate(
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

export async function preparePharmacyUpdatePayload(
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
