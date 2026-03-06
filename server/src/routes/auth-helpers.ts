import { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { asc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { ensureTestPharmacyColumnsAtStartup } from '../config/test-pharmacy-schema';
import { pharmacies } from '../db/schema';
import { isJwtSecretMissingError } from '../services/auth-service';
import { resolveServerTestLoginFeatureEnabled } from '../config/test-login-feature';
import { getErrorMessage } from '../middleware/error-handler';
import { logger } from '../services/logger';

export const TEST_PHARMACY_CACHE_TTL_MS = 60_000;
export const TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS = 5;

export type AuthMeRow = {
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  isAdmin: boolean | null;
  isTestAccount: boolean;
};

export type LegacyAuthMeRow = Omit<AuthMeRow, 'isTestAccount'>;

export type TestPharmacyPreviewRow = {
  id: number;
  name: string;
  email: string;
  prefecture: string;
  password: string | null;
};

export function createAuthLimiter(max: number, error: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error },
  });
}

export function isTestLoginFeatureEnabled(): boolean {
  return resolveServerTestLoginFeatureEnabled(process.env as {
    NODE_ENV?: string;
    VERCEL_ENV?: string;
    TEST_LOGIN_FEATURE_ENABLED?: string;
  });
}

export function handleAuthConfigurationError(context: string, err: unknown, res: Response): boolean {
  if (!isJwtSecretMissingError(err)) {
    return false;
  }

  logger.error(`${context} configuration error`, {
    error: (err as { message?: unknown }).message,
  });
  res.status(503).json({ error: '認証設定が未完了です。管理者に連絡してください' });
  return true;
}

export function extractUniqueViolationConstraint(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;

  const code = String((err as { code?: unknown }).code ?? '');
  if (code !== '23505') return null;

  const constraint = String((err as { constraint?: unknown }).constraint ?? '').toLowerCase();
  if (constraint) return constraint;

  const message = String((err as { message?: unknown }).message ?? '');
  const matched = message.match(/unique constraint "([^"]+)"/i);
  return matched?.[1]?.toLowerCase() ?? '';
}

export function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim().length > 0) {
    return code;
  }
  return extractErrorCode((err as { cause?: unknown }).cause);
}

export function includesIsTestAccountToken(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
  if (message.includes('is_test_account') || message.includes('test_account_password')) {
    return true;
  }
  return includesIsTestAccountToken((err as { cause?: unknown }).cause);
}

export function isMissingTestPharmacyColumnError(err: unknown): boolean {
  return extractErrorCode(err) === '42703' || includesIsTestAccountToken(err);
}

export function mapLegacyAuthMeRows(rows: LegacyAuthMeRow[]): AuthMeRow[] {
  return rows.map((row) => ({
    ...row,
    isTestAccount: false,
  }));
}

export async function selectLegacyAuthMeRows(pharmacyId: number): Promise<LegacyAuthMeRow[]> {
  return db.select({
    id: pharmacies.id,
    email: pharmacies.email,
    name: pharmacies.name,
    postalCode: pharmacies.postalCode,
    address: pharmacies.address,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    licenseNumber: pharmacies.licenseNumber,
    prefecture: pharmacies.prefecture,
    isAdmin: pharmacies.isAdmin,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);
}

export async function selectCurrentAuthMeRows(pharmacyId: number): Promise<AuthMeRow[]> {
  return db.select({
    id: pharmacies.id,
    email: pharmacies.email,
    name: pharmacies.name,
    postalCode: pharmacies.postalCode,
    address: pharmacies.address,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    licenseNumber: pharmacies.licenseNumber,
    prefecture: pharmacies.prefecture,
    isAdmin: pharmacies.isAdmin,
    isTestAccount: pharmacies.isTestAccount,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);
}

export function formatTestPharmacyAccounts(rows: TestPharmacyPreviewRow[], includePassword: boolean) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    prefecture: row.prefecture,
    password: includePassword ? (row.password ?? '') : '',
  }));
}

export function sendTestPharmacyResponse(
  res: Response,
  rows: TestPharmacyPreviewRow[],
  includePassword: boolean,
  cacheControlValue: string,
): void {
  if (rows.length === 0) {
    res.status(404).json({ error: 'テスト薬局がDBに登録されていません（5件登録を確認してください）' });
    return;
  }

  res.setHeader('Cache-Control', cacheControlValue);
  res.json({
    accounts: formatTestPharmacyAccounts(rows, includePassword),
  });
}

export async function selectFlaggedTestPharmacyRows(): Promise<TestPharmacyPreviewRow[]> {
  return db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    email: pharmacies.email,
    prefecture: pharmacies.prefecture,
    password: pharmacies.testAccountPassword,
  })
    .from(pharmacies)
    .where(eq(pharmacies.isTestAccount, true))
    .orderBy(asc(pharmacies.id))
    .limit(TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS);
}

export async function loadAuthMeRows(
  pharmacyId: number,
  isTestAccountColumnAvailable: boolean | null,
  setIsTestAccountColumnAvailable: (val: boolean) => void,
): Promise<AuthMeRow[]> {
  if (isTestAccountColumnAvailable === false) {
    return mapLegacyAuthMeRows(await selectLegacyAuthMeRows(pharmacyId));
  }

  try {
    const rows = await selectCurrentAuthMeRows(pharmacyId);
    setIsTestAccountColumnAvailable(true);
    return rows;
  } catch (err) {
    if (!isMissingTestPharmacyColumnError(err)) {
      throw err;
    }

    setIsTestAccountColumnAvailable(false);
    logger.warn('is_test_account column is not available yet; fallback to legacy /auth/me response', {
      error: getErrorMessage(err),
    });
    return mapLegacyAuthMeRows(await selectLegacyAuthMeRows(pharmacyId));
  }
}

export async function loadTestPharmacyRows(
  res: Response,
  isTestAccountColumnAvailable: boolean | null,
  setIsTestAccountColumnAvailable: (val: boolean) => void,
): Promise<TestPharmacyPreviewRow[] | null> {
  try {
    const rows = await selectFlaggedTestPharmacyRows();
    setIsTestAccountColumnAvailable(true);
    return rows;
  } catch (err) {
    if (!isMissingTestPharmacyColumnError(err)) {
      throw err;
    }

    logger.warn('test pharmacy columns are missing', {
      error: getErrorMessage(err),
    });
    const ensured = await ensureTestPharmacyColumnsAtStartup();
    if (ensured) {
      try {
        const healedRows = await selectFlaggedTestPharmacyRows();
        setIsTestAccountColumnAvailable(true);
        return healedRows;
      } catch (retryErr) {
        if (!isMissingTestPharmacyColumnError(retryErr)) {
          throw retryErr;
        }

        logger.warn('test pharmacy columns remain unavailable after ensure', {
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
      }
    }

    setIsTestAccountColumnAvailable(false);
    res.status(503).json({ error: 'テスト薬局機能のDBスキーマが未適用です。マイグレーションを実行してください' });
    return null;
  }
}
