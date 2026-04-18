import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { ensureTestPharmacyColumnsAtStartup } from '../config/test-pharmacy-schema';
import { pharmacies, pharmacyRegistrationReviews, userRequests } from '../db/schema';
import {
  assertJwtSecretConfigured,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  deriveSessionVersion,
  isJwtSecretMissingError,
} from '../services/auth-service';
import { validateRegistration, validateLogin, emailSchema, passwordSchema } from '../utils/validators';
import { geocodeAddress } from '../services/geocode-service';
import { AuthRequest } from '../types';
import { requireLogin, invalidateAuthUserCache } from '../middleware/auth';
import { clearCsrfCookie, ensureCsrfCookie, generateCsrfToken, setCsrfCookie } from '../middleware/csrf';
import { writeLog, getClientIp } from '../services/log-service';
import { createPasswordResetToken, resetPasswordWithToken } from '../services/password-reset-service';
import { logger } from '../services/logger';
import { handleRouteError } from '../middleware/error-handler';
import { evaluateRegistrationScreening } from '../services/registration-screening-service';
import { handoffToOpenClaw } from '../services/openclaw';
import { PHARMACY_VERIFICATION_REQUEST_TYPE } from '../services/pharmacy-verification-service';

const router = Router();

// Legacy password auth feature flag — "false" のみ無効化、未設定やそれ以外は有効
const LEGACY_PASSWORD_AUTH_ENABLED = process.env.LEGACY_PASSWORD_AUTH_ENABLED?.trim().toLowerCase() !== 'false';

function rejectIfLegacyPasswordDisabled(req: AuthRequest, res: Response, next: () => void): void {
  if (!LEGACY_PASSWORD_AUTH_ENABLED) {
    res.status(410).json({
      error: 'パスワードベースの認証は無効化されています。WorkOS AuthKit でログインしてください。',
    });
    return;
  }
  next();
}

const EXPOSE_PASSWORD_RESET_TOKEN = process.env.EXPOSE_PASSWORD_RESET_TOKEN === 'true';
if (process.env.NODE_ENV !== 'test' && EXPOSE_PASSWORD_RESET_TOKEN) {
  throw new Error('EXPOSE_PASSWORD_RESET_TOKEN=true は test 環境でのみ許可されています');
}
const SHOULD_EXPOSE_PASSWORD_RESET_TOKEN = process.env.NODE_ENV === 'test' && EXPOSE_PASSWORD_RESET_TOKEN;
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '登録試行回数が多すぎます。しばらくしてから再試行してください' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'ログイン試行回数が多すぎます。しばらくしてから再試行してください' },
});

const AUTH_CONFIGURATION_ERROR_MESSAGE = '認証設定が未完了です。管理者に連絡してください';
const PASSWORD_RESET_MIN_RESPONSE_MS = process.env.NODE_ENV === 'test' ? 0 : 180;
const PASSWORD_RESET_RESPONSE_JITTER_MS = process.env.NODE_ENV === 'test' ? 0 : 120;
const testPharmacyPreviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'テスト薬局情報の取得回数が多すぎます。しばらくしてから再試行してください' },
});

function handleAuthConfigurationError(context: string, err: unknown, res: Response): boolean {
  if (!isJwtSecretMissingError(err)) {
    return false;
  }

  logger.error(`${context} configuration error`, {
    error: err.message,
  });
  res.status(503).json({ error: AUTH_CONFIGURATION_ERROR_MESSAGE });
  return true;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractUniqueViolationConstraint(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;

  const code = String((err as { code?: unknown }).code ?? '');
  if (code !== '23505') return null;

  const constraint = String((err as { constraint?: unknown }).constraint ?? '').toLowerCase();
  if (constraint) return constraint;

  const message = String((err as { message?: unknown }).message ?? '');
  const matched = message.match(/unique constraint "([^"]+)"/i);
  return matched?.[1]?.toLowerCase() ?? '';
}

function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim().length > 0) {
    return code;
  }
  return extractErrorCode((err as { cause?: unknown }).cause);
}

function includesIsTestAccountToken(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
  if (message.includes('is_test_account') || message.includes('test_account_password')) {
    return true;
  }
  return includesIsTestAccountToken((err as { cause?: unknown }).cause);
}

function isMissingTestPharmacyColumnError(err: unknown): boolean {
  return extractErrorCode(err) === '42703' || includesIsTestAccountToken(err);
}
let isTestAccountColumnAvailable: boolean | null = null;
type TestAccountMode = 'user' | 'admin';

// テスト薬局リストのメモリキャッシュ（cold start 時の DB往復を回避）
const TEST_PHARMACY_CACHE_TTL_MS = 60_000;
const TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS = 5;
type TestPharmacyCacheEntry = {
  expiresAt: number;
  rows: Array<{ id: number; name: string; email: string; prefecture: string; password: string | null }>;
};
let testPharmacyCache: Record<TestAccountMode, TestPharmacyCacheEntry | null> = {
  user: null,
  admin: null,
};

export function clearTestPharmacyPreviewStateForTests(): void {
  isTestAccountColumnAvailable = null;
  testPharmacyCache = { user: null, admin: null };
}

function resolveTestAccountMode(value: unknown): TestAccountMode {
  return value === 'admin' ? 'admin' : 'user';
}

function buildMissingTestAccountMessage(mode: TestAccountMode): string {
  return mode === 'admin'
    ? 'テスト管理者アカウントがDBに登録されていません（検証用アカウントを確認してください）'
    : 'テスト薬局がDBに登録されていません（5件登録を確認してください）';
}

router.post('/register', rejectIfLegacyPasswordDisabled, registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validateRegistration(req.body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }
    assertJwtSecretConfigured();

    const {
      email,
      password,
      name,
      postalCode,
      address,
      phone,
      fax,
      licenseNumber,
      prefecture,
      permitLicenseNumber,
      permitPharmacyName,
      permitAddress,
    } = req.body;

    // Check existing email
    const existing = await db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.email, email))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
      return;
    }

    // Check existing license number
    const existingLicense = await db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.licenseNumber, licenseNumber))
      .limit(1);

    if (existingLicense.length > 0) {
      res.status(409).json({ error: 'この薬局開設許可番号は既に登録されています' });
      return;
    }

    const passwordHash = await hashPassword(password);

    // 住所からジオコーディング（都道府県+住所で検索）
    const fullAddress = `${prefecture}${address}`;
    const coords = await geocodeAddress(fullAddress);
    if (!coords) {
      res.status(400).json({
        errors: [{ field: 'address', message: '住所から位置情報を特定できませんでした。正しい住所を入力してください' }],
      });
      return;
    }

    const screening = evaluateRegistrationScreening({
      pharmacyName: name,
      prefecture,
      address,
      licenseNumber,
      permitLicenseNumber,
      permitPharmacyName,
      permitAddress,
    });

    const registrationIp = getClientIp(req);
    const normalizedPostalCode = postalCode.replace(/[-ー－\s]/g, '');
    const registrationResult = await db.transaction(async (tx) => {
      const [review] = await tx.insert(pharmacyRegistrationReviews).values({
        email,
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
        registrationIp,
      }).returning({ id: pharmacyRegistrationReviews.id });

      if (!screening.approved) {
        return {
          approved: false as const,
          reviewId: review.id,
        };
      }

      const [createdPharmacy] = await tx.insert(pharmacies).values({
        email,
        passwordHash,
        name,
        postalCode: normalizedPostalCode,
        address,
        phone,
        fax,
        licenseNumber,
        prefecture,
        latitude: coords.lat,
        longitude: coords.lng,
        isActive: false,
        verificationStatus: 'pending_verification',
      }).returning({ id: pharmacies.id });

      // Insert verification request into user_requests for OpenClaw verification
      const [verificationRequest] = await tx.insert(userRequests).values({
        pharmacyId: createdPharmacy.id,
        requestText: JSON.stringify({
          type: PHARMACY_VERIFICATION_REQUEST_TYPE,
          pharmacyName: name,
          postalCode: normalizedPostalCode,
          prefecture,
          address,
          licenseNumber,
          instruction: '薬局機能情報提供制度APIで検索し、薬局名と開設許可番号の一致を確認してください',
        }),
      }).returning({ id: userRequests.id });

      // Link verification request to pharmacy
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

    if (!registrationResult.approved) {
      writeLog('register', {
        detail: `失敗|phase=screening|reason=permit_mismatch|score=${screening.screeningScore}`,
        ipAddress: registrationIp,
      });
      res.status(403).json({
        error: '登録情報と薬局開設許可証情報が一致しないため、登録できません',
        screening: {
          score: screening.screeningScore,
          mismatches: screening.mismatches,
          reviewId: registrationResult.reviewId,
        },
      });
      return;
    }

    const pharmacyId = registrationResult.pharmacyId;

    writeLog('register', {
      pharmacyId,
      detail: `新規登録（審査待ち）: ${name}`,
      ipAddress: registrationIp,
    });

    res.status(201).json({
      message: '登録申請を受け付けました。審査完了後にメールでお知らせします。',
      verificationStatus: 'pending_verification',
      pharmacyId,
    });

    // Fire-and-forget: OpenClaw verification handoff
    handoffToOpenClaw({
      requestId: registrationResult.verificationRequestId,
      pharmacyId,
      requestText: JSON.stringify({
        type: PHARMACY_VERIFICATION_REQUEST_TYPE,
        pharmacyName: name,
        postalCode: normalizedPostalCode,
        prefecture,
        address,
        licenseNumber,
      }),
      context: {
        source: 'pharmacy_verification_request',
      },
    }).catch((err) => {
      logger.error('OpenClaw verification handoff failed', () => ({
        pharmacyId,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  } catch (err) {
    if (handleAuthConfigurationError('Registration', err, res)) {
      return;
    }

    const uniqueConstraint = extractUniqueViolationConstraint(err);
    if (uniqueConstraint !== null) {
      if (uniqueConstraint.includes('license')) {
        res.status(409).json({ error: 'この薬局開設許可番号は既に登録されています' });
        return;
      }
      if (uniqueConstraint.includes('email')) {
        res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
        return;
      }
      res.status(409).json({ error: 'この情報は既に登録されています' });
      return;
    }

    handleRouteError(err, 'Registration error', '登録に失敗しました', res);
  }
});

router.post('/login', rejectIfLegacyPasswordDisabled, loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validateLogin(req.body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }
    assertJwtSecretConfigured();

    const { email, password } = req.body;

    const rows = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.email, email))
      .limit(1);

    if (rows.length === 0) {
      res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
      return;
    }

    const pharmacy = rows[0];

    if (!pharmacy.isActive) {
      res.status(403).json({ error: 'このアカウントは無効になっています' });
      return;
    }

    if (!pharmacy.passwordHash) {
      res.status(401).json({ error: 'パスワード認証が設定されていません。別の方法でログインしてください。' });
      return;
    }

    const valid = await verifyPassword(password, pharmacy.passwordHash);
    if (!valid) {
      writeLog('login_failed', { detail: `ログイン失敗: ${email}`, ipAddress: getClientIp(req) });
      res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
      return;
    }

    const token = generateToken({
      id: pharmacy.id,
      email: pharmacy.email,
      isAdmin: pharmacy.isAdmin ?? false,
      sessionVersion: deriveSessionVersion(pharmacy.passwordHash),
    });
    invalidateAuthUserCache(pharmacy.id);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });
    setCsrfCookie(res, generateCsrfToken());

    const logAction = pharmacy.isAdmin ? 'admin_login' as const : 'login' as const;
    writeLog(logAction, { pharmacyId: pharmacy.id, detail: `ログイン: ${pharmacy.name}`, ipAddress: getClientIp(req) });

    res.json({
      id: pharmacy.id,
      email: pharmacy.email,
      name: pharmacy.name,
      prefecture: pharmacy.prefecture,
      isAdmin: pharmacy.isAdmin,
    });
  } catch (err) {
    if (handleAuthConfigurationError('Login', err, res)) {
      return;
    }

    handleRouteError(err, 'Login error', 'ログインに失敗しました', res);
  }
});

router.post('/password-reset/request', rejectIfLegacyPasswordDisabled, loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const requestStartedAt = Date.now();
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!email) {
      res.status(400).json({ error: 'メールアドレスを入力してください' });
      return;
    }
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      res.status(400).json({ error: emailResult.error.issues[0].message });
      return;
    }

    const result = await createPasswordResetToken(email);
    const targetMs = PASSWORD_RESET_MIN_RESPONSE_MS
      + (PASSWORD_RESET_RESPONSE_JITTER_MS > 0
        ? Math.floor(Math.random() * (PASSWORD_RESET_RESPONSE_JITTER_MS + 1))
        : 0);
    const elapsedMs = Date.now() - requestStartedAt;
    if (elapsedMs < targetMs) {
      await waitMs(targetMs - elapsedMs);
    }

    // Always return success to prevent email enumeration
    writeLog('password_reset_request', {
      detail: 'パスワードリセット要求を受理',
      ipAddress: getClientIp(req),
    });

    res.json({
      message: 'パスワードリセットの手続きを受け付けました',
      // Token exposure should be explicitly enabled only in secured dev/test environments.
      ...(SHOULD_EXPOSE_PASSWORD_RESET_TOKEN && result ? { token: result.token } : {}),
    });
  } catch (err) {
    handleRouteError(err, 'Password reset request error', 'パスワードリセットに失敗しました', res);
  }
});

router.post('/password-reset/confirm', rejectIfLegacyPasswordDisabled, loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      res.status(400).json({ error: 'リセットトークンが無効です' });
      return;
    }

    const passwordResult = passwordSchema.safeParse(newPassword);
    if (!passwordResult.success) {
      res.status(400).json({ error: passwordResult.error.issues[0].message });
      return;
    }

    const resetResult = await resetPasswordWithToken(token, newPassword);
    if (!resetResult.success) {
      writeLog('password_reset_failed', { detail: 'リセットトークン無効または期限切れ', ipAddress: getClientIp(req) });
      res.status(400).json({ error: 'リセットトークンが無効または期限切れです' });
      return;
    }
    invalidateAuthUserCache(resetResult.pharmacyId);

    writeLog('password_reset_complete', { detail: 'パスワードリセット完了', ipAddress: getClientIp(req) });
    res.json({ message: 'パスワードをリセットしました。新しいパスワードでログインしてください' });
  } catch (err) {
    handleRouteError(err, 'Password reset confirm error', 'パスワードリセットに失敗しました', res);
  }
});

router.post('/logout', (req: AuthRequest, res: Response) => {
  let pharmacyId: number | null = null;
  const token = typeof req.cookies?.token === 'string' ? req.cookies.token : '';
  if (token) {
    try {
      const payload = verifyToken(token);
      pharmacyId = payload.id;
    } catch {
      // ignore invalid token
    }
  }

  res.clearCookie('token');
  clearCsrfCookie(res);
  if (pharmacyId !== null) {
    invalidateAuthUserCache(pharmacyId);
  }
  void writeLog('logout', {
    pharmacyId,
    detail: 'ログアウト',
    ipAddress: getClientIp(req),
  });
  res.json({ message: 'ログアウトしました' });
});

router.get('/csrf-token', (req: AuthRequest, res: Response) => {
  const token = ensureCsrfCookie(req, res);
  res.json({ csrfToken: token });
});

router.get('/me', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    let rows: Array<{
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
    }>;

    if (isTestAccountColumnAvailable === false) {
      const legacyRows = await db.select({
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
        .where(eq(pharmacies.id, req.user!.id))
        .limit(1);

      rows = legacyRows.map((row) => ({
        ...row,
        isTestAccount: false,
      }));
    } else {
      try {
        rows = await db.select({
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
          .where(eq(pharmacies.id, req.user!.id))
          .limit(1);
        isTestAccountColumnAvailable = true;
      } catch (err) {
        if (!isMissingTestPharmacyColumnError(err)) {
          throw err;
        }
        isTestAccountColumnAvailable = false;
        logger.warn('is_test_account column is not available yet; fallback to legacy /auth/me response', {
          error: err instanceof Error ? err.message : String(err),
        });
        const legacyRows = await db.select({
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
          .where(eq(pharmacies.id, req.user!.id))
          .limit(1);
        rows = legacyRows.map((row) => ({
          ...row,
          isTestAccount: false,
        }));
      }
    }

    if (rows.length === 0) {
      res.status(404).json({ error: 'ユーザーが見つかりません' });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    handleRouteError(err, 'Get me error', 'ユーザー情報の取得に失敗しました', res);
  }
});

router.get('/test-pharmacies', testPharmacyPreviewLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const includePasswordRaw = req.query.includePassword;
    // In production, password exposure requires explicit opt-in via env var to prevent accidental credential leakage
    const isPasswordExposureAllowed = process.env.NODE_ENV !== 'production'
      || process.env.EXPOSE_TEST_PHARMACY_PASSWORDS === 'true';
    const includePassword = (includePasswordRaw === '1' || includePasswordRaw === 'true') && isPasswordExposureAllowed;
    const mode = resolveTestAccountMode(req.query.mode);
    const cacheControlValue = includePassword ? 'no-store' : 'private, max-age=60';
    const cachedEntry = testPharmacyCache[mode];

    // キャッシュが有効ならDBアクセスをスキップ
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      const cached = cachedEntry.rows;
      if (cached.length === 0) {
        res.status(404).json({ error: buildMissingTestAccountMessage(mode) });
        return;
      }
      res.setHeader('Cache-Control', cacheControlValue);
      res.json({
        accounts: cached.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          prefecture: row.prefecture,
          password: includePassword ? (row.password ?? '') : '',
        })),
      });
      return;
    }

    const rows = await (async () => {
      const getRowsFromFlag = () => db.select({
        id: pharmacies.id,
        name: pharmacies.name,
        email: pharmacies.email,
        prefecture: pharmacies.prefecture,
        password: pharmacies.testAccountPassword,
      })
        .from(pharmacies)
        .where(and(
          eq(pharmacies.isTestAccount, true),
          eq(pharmacies.isAdmin, mode === 'admin'),
        ))
        .orderBy(asc(pharmacies.id))
        .limit(TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS);

      try {
        const currentRows = await getRowsFromFlag();
        isTestAccountColumnAvailable = true;
        return currentRows;
      } catch (err) {
        if (!isMissingTestPharmacyColumnError(err)) {
          throw err;
        }
        logger.warn('test pharmacy columns are missing', {
          error: err instanceof Error ? err.message : String(err),
        });
        const ensured = await ensureTestPharmacyColumnsAtStartup();
        if (ensured) {
          try {
            const healedRows = await getRowsFromFlag();
            isTestAccountColumnAvailable = true;
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
        isTestAccountColumnAvailable = false;
        res.status(503).json({ error: 'テスト薬局機能のDBスキーマが未適用です。マイグレーションを実行してください' });
        return null;
      }
    })();
    if (!rows) {
      return;
    }

    if (rows.length === 0) {
      res.status(404).json({ error: buildMissingTestAccountMessage(mode) });
      return;
    }

    // 空結果はキャッシュせず、登録直後の 404 残留を避ける。
    testPharmacyCache[mode] = { expiresAt: Date.now() + TEST_PHARMACY_CACHE_TTL_MS, rows };

    res.setHeader('Cache-Control', cacheControlValue);
    res.json({
      accounts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        prefecture: row.prefecture,
        password: includePassword ? (row.password ?? '') : '',
      })),
    });
  } catch (err) {
    handleRouteError(err, 'Get test pharmacies error', 'テスト薬局情報の取得に失敗しました', res);
  }
});

export default router;
