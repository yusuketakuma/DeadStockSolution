import { Router, Response } from 'express';
import { db } from '../config/database';
import { pharmacies, pharmacyRegistrationReviews, userRequests } from '../db/schema';
import { asc, eq } from 'drizzle-orm';
import { ensureTestPharmacyColumnsAtStartup } from '../config/test-pharmacy-schema';
import {
  assertJwtSecretConfigured,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  deriveSessionVersion,
} from '../services/auth-service';
import { validateRegistration, validateLogin, emailSchema, passwordSchema } from '../utils/validators';
import { geocodeAddress } from '../services/geocode-service';
import { AuthRequest } from '../types';
import { requireLogin, invalidateAuthUserCache } from '../middleware/auth';
import { clearCsrfCookie, ensureCsrfCookie, generateCsrfToken, setCsrfCookie } from '../middleware/csrf';
import { writeLog, getClientIp } from '../services/log-service';
import { createPasswordResetToken, resetPasswordWithToken } from '../services/password-reset-service';
import { logger } from '../services/logger';
import { handleRouteError, getErrorMessage } from '../middleware/error-handler';
import {
  createAuthLimiter,
  isTestLoginFeatureEnabled,
  handleAuthConfigurationError,
  extractUniqueViolationConstraint,
  isMissingTestPharmacyColumnError,
  mapLegacyAuthMeRows,
  selectLegacyAuthMeRows,
  selectCurrentAuthMeRows,
  loadAuthMeRows,
  formatTestPharmacyAccounts,
  sendTestPharmacyResponse,
  selectFlaggedTestPharmacyRows,
  loadTestPharmacyRows,
  checkExistingPharmacy,
  normalizePostalCode,
  buildFullAddress,
  setAuthCookie,
  getLoginLogAction,
  buildLoginResponse,
  calculatePasswordResetDelay,
  buildPasswordResetResponse,
  validateResetToken,
  extractPharmacyIdFromToken,
  parseIncludePasswordQuery,
  getCacheControlValue,
  isCacheValid,
  buildRegistrationRejectionResponse,
  buildRegistrationSuccessResponse,
  buildVerificationRequestText,
  findPharmacyByEmail,
  buildTokenPayload,
  buildPasswordResetCompleteResponse,
  validateEmail,
  validatePassword,
  buildCsrfTokenResponse,
  buildLogoutResponse,
  buildUserNotFoundResponse,
  buildTestLoginDisabledResponse,
  buildEmailAlreadyRegisteredResponse,
  buildLicenseAlreadyRegisteredResponse,
  buildInvalidAddressResponse,
  buildInvalidResetTokenResponse,
  buildInvalidPasswordResetResponse,
  buildInactiveAccountResponse,
  buildInvalidCredentialsResponse,
  buildValidationErrorResponse,
  type AuthMeRow,
  type LegacyAuthMeRow,
  type TestPharmacyPreviewRow,
} from './auth-helpers';
import { sleep } from '../utils/http-utils';
import { eqEmailCaseInsensitive, normalizeEmail } from '../utils/email-utils';
import { evaluateRegistrationScreening } from '../services/registration-screening-service';
import { handoffToOpenClaw } from '../services/openclaw-service';
import { PHARMACY_VERIFICATION_REQUEST_TYPE } from '../services/pharmacy-verification-service';

const router = Router();
const EXPOSE_PASSWORD_RESET_TOKEN = process.env.EXPOSE_PASSWORD_RESET_TOKEN === 'true';
if (process.env.NODE_ENV !== 'test' && EXPOSE_PASSWORD_RESET_TOKEN) {
  throw new Error('EXPOSE_PASSWORD_RESET_TOKEN=true は test 環境でのみ許可されています');
}
const SHOULD_EXPOSE_PASSWORD_RESET_TOKEN = process.env.NODE_ENV === 'test' && EXPOSE_PASSWORD_RESET_TOKEN;
const AUTH_CONFIGURATION_ERROR_MESSAGE = '認証設定が未完了です。管理者に連絡してください';
const PASSWORD_RESET_MIN_RESPONSE_MS = process.env.NODE_ENV === 'test' ? 0 : 180;
const PASSWORD_RESET_RESPONSE_JITTER_MS = process.env.NODE_ENV === 'test' ? 0 : 120;
const registerLimiter = createAuthLimiter(5, '登録試行回数が多すぎます。しばらくしてから再試行してください');
const loginLimiter = createAuthLimiter(10, 'ログイン試行回数が多すぎます。しばらくしてから再試行してください');
const testPharmacyPreviewLimiter = createAuthLimiter(30, 'テスト薬局情報の取得回数が多すぎます。しばらくしてから再試行してください');
let isTestAccountColumnAvailable: boolean | null = null;

// テスト薬局リストのメモリキャッシュ（cold start 時の DB往復を回避）
const TEST_PHARMACY_CACHE_TTL_MS = 60_000;
const TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS = 5;
let testPharmacyCache: {
  expiresAt: number;
  rows: TestPharmacyPreviewRow[];
} | null = null;

router.post('/register', registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validateRegistration(req.body);
    if (errors.length > 0) {
      res.status(400).json(buildValidationErrorResponse(errors));
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
    const normalizedEmail = normalizeEmail(email);

    // Check existing email
    const { existingEmail, existingLicense } = await checkExistingPharmacy(normalizedEmail, licenseNumber);

    if (existingEmail) {
      res.status(409).json(buildEmailAlreadyRegisteredResponse());
      return;
    }

    if (existingLicense) {
      res.status(409).json(buildLicenseAlreadyRegisteredResponse());
      return;
    }

    const passwordHash = await hashPassword(password);

    // 住所からジオコーディング（都道府県+住所で検索）
    const fullAddress = buildFullAddress(prefecture, address);
    const coords = await geocodeAddress(fullAddress);
    if (!coords) {
      res.status(400).json(buildInvalidAddressResponse());
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
    const normalizedPostalCode = normalizePostalCode(postalCode);
    const registrationResult = await db.transaction(async (tx) => {
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
        registrationIp,
      }).returning({ id: pharmacyRegistrationReviews.id });

      if (!screening.approved) {
        return {
          approved: false as const,
          reviewId: review.id,
        };
      }

      const [createdPharmacy] = await tx.insert(pharmacies).values({
        email: normalizedEmail,
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
        requestText: buildVerificationRequestText(name, normalizedPostalCode, prefecture, address, licenseNumber),
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
      void writeLog('register', {
        detail: `失敗|phase=screening|reason=permit_mismatch|score=${screening.screeningScore}`,
        ipAddress: registrationIp,
      });
      res.status(403).json(buildRegistrationRejectionResponse(screening, registrationResult.reviewId));
      return;
    }

    const pharmacyId = registrationResult.pharmacyId;

    void writeLog('register', {
      pharmacyId,
      detail: `新規登録（審査待ち）: ${name}`,
      ipAddress: registrationIp,
    });

    res.status(201).json(buildRegistrationSuccessResponse(pharmacyId));

    // Fire-and-forget: OpenClaw verification handoff
    handoffToOpenClaw({
      requestId: registrationResult.verificationRequestId,
      pharmacyId,
      requestText: buildVerificationRequestText(name, normalizedPostalCode, prefecture, address, licenseNumber),
    }).catch((err) => {
      logger.error('OpenClaw verification handoff failed', () => ({
        pharmacyId,
        error: getErrorMessage(err),
      }));
    });
  } catch (err) {
    if (handleAuthConfigurationError('Registration', err, res)) {
      return;
    }

    const uniqueConstraint = extractUniqueViolationConstraint(err);
    if (uniqueConstraint !== null) {
      if (uniqueConstraint.includes('license')) {
        res.status(409).json(buildLicenseAlreadyRegisteredResponse());
        return;
      }
      if (uniqueConstraint.includes('email')) {
        res.status(409).json(buildEmailAlreadyRegisteredResponse());
        return;
      }
      res.status(409).json({ error: 'この情報は既に登録されています' });
      return;
    }

    handleRouteError(err, 'Registration error', '登録に失敗しました', res);
  }
});

router.post('/login', loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validateLogin(req.body);
    if (errors.length > 0) {
      res.status(400).json(buildValidationErrorResponse(errors));
      return;
    }
    assertJwtSecretConfigured();

    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    const pharmacy = await findPharmacyByEmail(normalizedEmail);

    if (!pharmacy) {
      res.status(401).json(buildInvalidCredentialsResponse());
      return;
    }

    if (!pharmacy.isActive) {
      res.status(403).json(buildInactiveAccountResponse());
      return;
    }

    const valid = await verifyPassword(password, pharmacy.passwordHash);
    if (!valid) {
      void writeLog('login_failed', { detail: `ログイン失敗: ${normalizedEmail}`, ipAddress: getClientIp(req) });
      res.status(401).json(buildInvalidCredentialsResponse());
      return;
    }

    const token = generateToken(buildTokenPayload(pharmacy));
    invalidateAuthUserCache(pharmacy.id);

    setAuthCookie(res, token, process.env.NODE_ENV === 'production');
    setCsrfCookie(res, generateCsrfToken());

    const logAction = getLoginLogAction(pharmacy.isAdmin);
    void writeLog(logAction, { pharmacyId: pharmacy.id, detail: `ログイン: ${pharmacy.name}`, ipAddress: getClientIp(req) });

    res.json(buildLoginResponse(pharmacy));
  } catch (err) {
    if (handleAuthConfigurationError('Login', err, res)) {
      return;
    }

    handleRouteError(err, 'Login error', 'ログインに失敗しました', res);
  }
});

router.post('/password-reset/request', loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const requestStartedAt = Date.now();
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    if (!email) {
      res.status(400).json({ error: 'メールアドレスを入力してください' });
      return;
    }
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      res.status(400).json({ error: emailValidation.error });
      return;
    }

    const result = await createPasswordResetToken(email);
    await calculatePasswordResetDelay(requestStartedAt, PASSWORD_RESET_MIN_RESPONSE_MS, PASSWORD_RESET_RESPONSE_JITTER_MS);

    // Always return success to prevent email enumeration
    void writeLog('password_reset_request', {
      detail: 'パスワードリセット要求を受理',
      ipAddress: getClientIp(req),
    });

    res.json(buildPasswordResetResponse(SHOULD_EXPOSE_PASSWORD_RESET_TOKEN, result));
  } catch (err) {
    handleRouteError(err, 'Password reset request error', 'パスワードリセットに失敗しました', res);
  }
});

router.post('/password-reset/confirm', loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!validateResetToken(token)) {
      res.status(400).json(buildInvalidResetTokenResponse());
      return;
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      res.status(400).json({ error: passwordValidation.error });
      return;
    }

    const resetResult = await resetPasswordWithToken(token, newPassword);
    if (!resetResult.success) {
      void writeLog('password_reset_failed', { detail: 'リセットトークン無効または期限切れ', ipAddress: getClientIp(req) });
      res.status(400).json(buildInvalidPasswordResetResponse());
      return;
    }
    invalidateAuthUserCache(resetResult.pharmacyId);

    void writeLog('password_reset_complete', { detail: 'パスワードリセット完了', ipAddress: getClientIp(req) });
    res.json(buildPasswordResetCompleteResponse());
  } catch (err) {
    handleRouteError(err, 'Password reset confirm error', 'パスワードリセットに失敗しました', res);
  }
});

router.post('/logout', (req: AuthRequest, res: Response) => {
  const token = typeof req.cookies?.token === 'string' ? req.cookies.token : '';
  const pharmacyId = extractPharmacyIdFromToken(token);

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
  res.json(buildLogoutResponse());
});

router.get('/csrf-token', (req: AuthRequest, res: Response) => {
  const token = ensureCsrfCookie(req, res);
  res.json(buildCsrfTokenResponse(token));
});

router.get('/me', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await loadAuthMeRows(req.user!.id, isTestAccountColumnAvailable, (val) => { isTestAccountColumnAvailable = val; });

    if (rows.length === 0) {
      res.status(404).json(buildUserNotFoundResponse());
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    handleRouteError(err, 'Get me error', 'ユーザー情報の取得に失敗しました', res);
  }
});

router.get('/test-pharmacies', testPharmacyPreviewLimiter, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTestLoginFeatureEnabled()) {
      res.status(404).json(buildTestLoginDisabledResponse());
      return;
    }

    const includePassword = parseIncludePasswordQuery(req.query.includePassword);
    const cacheControlValue = getCacheControlValue(includePassword);

    // キャッシュが有効ならDBアクセスをスキップ
    if (isCacheValid(testPharmacyCache)) {
      sendTestPharmacyResponse(res, testPharmacyCache!.rows, includePassword, cacheControlValue);
      return;
    }

    const rows = await loadTestPharmacyRows(res, isTestAccountColumnAvailable, (val) => { isTestAccountColumnAvailable = val; });
    if (!rows) {
      return;
    }

    // 結果をキャッシュ（テスト薬局データはほぼ変わらない）
    testPharmacyCache = { expiresAt: Date.now() + TEST_PHARMACY_CACHE_TTL_MS, rows };

    sendTestPharmacyResponse(res, rows, includePassword, cacheControlValue);
  } catch (err) {
    handleRouteError(err, 'Get test pharmacies error', 'テスト薬局情報の取得に失敗しました', res);
  }
});

export default router;
