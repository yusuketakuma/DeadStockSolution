import { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { ensureTestPharmacyColumnsAtStartup } from '../config/test-pharmacy-schema';
import { pharmacies, pharmacyRegistrationReviews, userRequests } from '../db/schema';
import { eqEmailCaseInsensitive, normalizeEmail } from '../utils/email-utils';
import { emailSchema, passwordSchema } from '../utils/validators';
import { isJwtSecretMissingError, verifyToken, deriveSessionVersion } from '../services/auth-service';
import { resolveServerTestLoginFeatureEnabled } from '../config/test-login-feature';
import { getErrorMessage } from '../middleware/error-handler';
import { logger } from '../services/logger';
import { sleep } from '../utils/http-utils';
import { PHARMACY_VERIFICATION_REQUEST_TYPE } from '../services/pharmacy-verification-service';

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
    // Never expose account credentials from the database.
    password: sql<string | null>`NULL`,
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

export async function checkExistingPharmacy(
  normalizedEmail: string,
  licenseNumber: string,
): Promise<{ existingEmail: boolean; existingLicense: boolean }> {
  const [existing, existingLicense] = await Promise.all([
    db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eqEmailCaseInsensitive(pharmacies.email, normalizedEmail))
      .limit(1),
    db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.licenseNumber, licenseNumber))
      .limit(1),
  ]);

  return {
    existingEmail: existing.length > 0,
    existingLicense: existingLicense.length > 0,
  };
}

export function normalizePostalCode(postalCode: string): string {
  return postalCode.replace(/[-ー－\s]/g, '');
}

export function buildFullAddress(prefecture: string, address: string): string {
  return `${prefecture}${address}`;
}

export function setAuthCookie(
  res: Response,
  token: string,
  isProduction: boolean,
): void {
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

export function getLoginLogAction(isAdmin: boolean | null): 'admin_login' | 'login' {
  return isAdmin ? 'admin_login' : 'login';
}

export function buildLoginResponse(pharmacy: {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  isAdmin: boolean | null;
}) {
  return {
    id: pharmacy.id,
    email: pharmacy.email,
    name: pharmacy.name,
    prefecture: pharmacy.prefecture,
    isAdmin: pharmacy.isAdmin,
  };
}

export async function calculatePasswordResetDelay(
  requestStartedAt: number,
  minResponseMs: number,
  jitterMs: number,
): Promise<void> {
  const targetMs = minResponseMs
    + (jitterMs > 0
      ? Math.floor(Math.random() * (jitterMs + 1))
      : 0);
  const elapsedMs = Date.now() - requestStartedAt;
  if (elapsedMs < targetMs) {
    await sleep(targetMs - elapsedMs);
  }
}

export function buildPasswordResetResponse(
  shouldExposeToken: boolean,
  result?: { token: string; pharmacyName: string } | null,
) {
  return {
    message: 'パスワードリセットの手続きを受け付けました',
    ...(shouldExposeToken && result ? { token: result.token } : {}),
  };
}

export function validateResetToken(token: string): boolean {
  return token.length > 0 && /^[a-f0-9]{64}$/.test(token);
}

export function extractPharmacyIdFromToken(token: string): number | null {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload.id;
  } catch {
    return null;
  }
}

export function parseIncludePasswordQuery(includePasswordRaw: unknown): boolean {
  return includePasswordRaw === '1' || includePasswordRaw === 'true';
}

export function getCacheControlValue(includePassword: boolean): string {
  return includePassword ? 'no-store' : 'private, max-age=60';
}

export function isCacheValid(
  cache: { expiresAt: number; rows: TestPharmacyPreviewRow[] } | null,
): boolean {
  return cache !== null && cache.expiresAt > Date.now();
}

export function buildRegistrationRejectionResponse(
  screening: { screeningScore: number; mismatches: unknown[] },
  reviewId: number,
) {
  return {
    error: '登録情報と薬局開設許可証情報が一致しないため、登録できません',
    screening: {
      score: screening.screeningScore,
      mismatches: screening.mismatches,
      reviewId,
    },
  };
}

export function buildRegistrationSuccessResponse(pharmacyId: number) {
  return {
    message: '登録申請を受け付けました。審査完了後にメールでお知らせします。',
    verificationStatus: 'pending_verification',
    pharmacyId,
  };
}

export function buildVerificationRequestText(
  pharmacyName: string,
  postalCode: string,
  prefecture: string,
  address: string,
  licenseNumber: string,
): string {
  return JSON.stringify({
    type: PHARMACY_VERIFICATION_REQUEST_TYPE,
    pharmacyName,
    postalCode,
    prefecture,
    address,
    licenseNumber,
    instruction: '薬局機能情報提供制度APIで検索し、薬局名と開設許可番号の一致を確認してください',
  });
}

export async function findPharmacyByEmail(normalizedEmail: string) {
  const rows = await db.select()
    .from(pharmacies)
    .where(eqEmailCaseInsensitive(pharmacies.email, normalizedEmail))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export function buildTokenPayload(pharmacy: {
  id: number;
  email: string;
  isAdmin: boolean | null;
  passwordHash: string;
}) {
  return {
    id: pharmacy.id,
    email: pharmacy.email,
    isAdmin: pharmacy.isAdmin ?? false,
    sessionVersion: deriveSessionVersion(pharmacy.passwordHash),
  };
}

export function buildPasswordResetCompleteResponse() {
  return { message: 'パスワードをリセットしました。新しいパスワードでログインしてください' };
}

export function validateEmail(email: string): { valid: boolean; error?: string } {
  const result = emailSchema.safeParse(email);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0].message };
  }
  return { valid: true };
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  const result = passwordSchema.safeParse(password);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0].message };
  }
  return { valid: true };
}

export function buildCsrfTokenResponse(token: string) {
  return { csrfToken: token };
}

export function buildLogoutResponse() {
  return { message: 'ログアウトしました' };
}

export function buildUserNotFoundResponse() {
  return { error: 'ユーザーが見つかりません' };
}

export function buildTestLoginDisabledResponse() {
  return { error: 'テストログインは無効です' };
}

export function buildEmailAlreadyRegisteredResponse() {
  return { error: 'このメールアドレスは既に登録されています' };
}

export function buildLicenseAlreadyRegisteredResponse() {
  return { error: 'この薬局開設許可番号は既に登録されています' };
}

export function buildInvalidAddressResponse() {
  return {
    errors: [{ field: 'address', message: '住所から位置情報を特定できませんでした。正しい住所を入力してください' }],
  };
}

export function buildInvalidResetTokenResponse() {
  return { error: 'リセットトークンが無効です' };
}

export function buildInvalidPasswordResetResponse() {
  return { error: 'リセットトークンが無効または期限切れです' };
}

export function buildInactiveAccountResponse() {
  return { error: 'このアカウントは無効になっています' };
}

export function buildInvalidCredentialsResponse() {
  return { error: 'メールアドレスまたはパスワードが正しくありません' };
}

export function buildValidationErrorResponse(errors: unknown[]) {
  return { errors };
}

// Auth configuration constants
export const EXPOSE_PASSWORD_RESET_TOKEN = process.env.EXPOSE_PASSWORD_RESET_TOKEN === 'true';
export const SHOULD_EXPOSE_PASSWORD_RESET_TOKEN = process.env.NODE_ENV === 'test' && EXPOSE_PASSWORD_RESET_TOKEN;
export const AUTH_CONFIGURATION_ERROR_MESSAGE = '認証設定が未完了です。管理者に連絡してください';
export const PASSWORD_RESET_MIN_RESPONSE_MS = process.env.NODE_ENV === 'test' ? 0 : 180;
export const PASSWORD_RESET_RESPONSE_JITTER_MS = process.env.NODE_ENV === 'test' ? 0 : 120;

// Auth limiters
export const registerLimiter = createAuthLimiter(5, '登録試行回数が多すぎます。しばらくしてから再試行してください');
export const loginLimiter = createAuthLimiter(10, 'ログイン試行回数が多すぎます。しばらくしてから再試行してください');
export const testPharmacyPreviewLimiter = createAuthLimiter(30, 'テスト薬局情報の取得回数が多すぎます。しばらくしてから再試行してください');

// Test pharmacy cache state
export let isTestAccountColumnAvailable: boolean | null = null;
export let testPharmacyCache: {
  expiresAt: number;
  rows: TestPharmacyPreviewRow[];
} | null = null;

// Cache management
export function setTestPharmacyCache(cache: { expiresAt: number; rows: TestPharmacyPreviewRow[] } | null): void {
  testPharmacyCache = cache;
}

export function setIsTestAccountColumnAvailable(val: boolean): void {
  isTestAccountColumnAvailable = val;
}


// Password reset request validation
export function validatePasswordResetRequest(email: string): { valid: boolean; error?: string } {
  if (!email) {
    return { valid: false, error: 'メールアドレスを入力してください' };
  }
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return { valid: false, error: emailValidation.error };
  }
  return { valid: true };
}

// Password reset confirm validation
export function validatePasswordResetConfirm(token: string, newPassword: string): { valid: boolean; error?: string } {
  if (!validateResetToken(token)) {
    return { valid: false, error: 'invalid_token' };
  }
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return { valid: false, error: passwordValidation.error };
  }
  return { valid: true };
}

// Login helper
export function validateLoginInput(email: string, password: string): { valid: boolean; error?: string } {
  if (!email || !password) {
    return { valid: false, error: 'メールアドレスとパスワードを入力してください' };
  }
  return { valid: true };
}

// Registration process helper - handles the core registration logic
export async function executeRegistrationProcess(
  normalizedEmail: string,
  passwordHash: string,
  name: string,
  normalizedPostalCode: string,
  prefecture: string,
  address: string,
  phone: string,
  fax: string,
  licenseNumber: string,
  permitLicenseNumber: string,
  permitPharmacyName: string,
  permitAddress: string,
  coords: { lat: number; lng: number },
  screening: any,
) {
  return db.transaction(async (tx) => {
    const [review] = await tx.insert(pharmacyRegistrationReviews).values({
      email: normalizedEmail,
      pharmacyName: name,
      postalCode: normalizedPostalCode,
      prefecture,
      address,
      phone,
      fax,
      licenseNumber,
      permitLicenseNumber,
      permitPharmacyName,
      permitAddress,
      verdict: screening.approved ? 'approved' : 'rejected',
      screeningScore: screening.screeningScore,
      screeningReasons: screening.reasons.join(' / '),
      mismatchDetailsJson: screening.mismatches.length > 0
        ? JSON.stringify(screening.mismatches)
        : null,
      registrationIp: '',
    }).returning({ id: pharmacyRegistrationReviews.id });

    if (!screening.approved) {
      return { approved: false as const, reviewId: review.id };
    }

    const [createdPharmacy] = await tx.insert(pharmacies).values({
      email: normalizedEmail,
      passwordHash,
      name,
      postalCode: normalizedPostalCode,
      prefecture,
      address,
      phone,
      fax,
      licenseNumber,
      latitude: coords.lat,
      longitude: coords.lng,
      isActive: false,
      verificationStatus: 'pending_verification',
    }).returning({ id: pharmacies.id });

    const [verificationRequest] = await tx.insert(userRequests).values({
      pharmacyId: createdPharmacy.id,
      requestText: buildVerificationRequestText(name, normalizedPostalCode, prefecture, address, licenseNumber),
    }).returning({ id: userRequests.id });

    await tx.update(pharmacies)
      .set({ verificationRequestId: verificationRequest.id })
      .where(eq(pharmacies.id, createdPharmacy.id));

    await tx.update(pharmacyRegistrationReviews)
      .set({
        createdPharmacyId: createdPharmacy.id,
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(pharmacyRegistrationReviews.id, review.id));

    return {
      approved: true as const,
      reviewId: review.id,
      pharmacyId: createdPharmacy.id,
      verificationRequestId: verificationRequest.id,
    };
  });
}
