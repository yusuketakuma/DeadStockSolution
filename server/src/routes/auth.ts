import { Router, Response } from 'express';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  assertJwtSecretConfigured,
  hashPassword,
  verifyPassword,
  generateToken,
} from '../services/auth-service';
import { validateRegistration, validateLogin, validateOnboardingRegistration } from '../utils/validators';
import { geocodeAddress } from '../services/geocode-service';
import { AuthRequest } from '../types';
import { requireLogin, invalidateAuthUserCache } from '../middleware/auth';
import { clearCsrfCookie, ensureCsrfCookie, generateCsrfToken, setCsrfCookie } from '../middleware/csrf';
import { writeLog, getClientIp } from '../services/log-service';
import { createPasswordResetToken, resetPasswordWithToken } from '../services/password-reset-service';
import { logger } from '../services/logger';
import { handleRouteError, getErrorMessage } from '../middleware/error-handler';
import {
  getAuthorizationUrl,
  authenticateWithCode,
  findOrLinkPharmacy,
  generateOnboardingToken,
  verifyOnboardingToken,
} from '../services/workos-service';
import {
  isTestLoginFeatureEnabled,
  handleAuthConfigurationError,
  handleDependencyServiceUnavailable,
  extractUniqueViolationConstraint,
  loadAuthMeRows,
  sendTestPharmacyResponse,
  loadTestPharmacyRows,
  checkExistingPharmacy,
  normalizePostalCode,
  buildFullAddress,
  setAuthCookie,
  getLoginLogAction,
  buildLoginResponse,
  calculatePasswordResetDelay,
  buildPasswordResetResponse,
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
  validatePasswordResetRequest,
  validatePasswordResetConfirm,
  executeRegistrationProcess,
  EXPOSE_PASSWORD_RESET_TOKEN,
  SHOULD_EXPOSE_PASSWORD_RESET_TOKEN,
  PASSWORD_RESET_MIN_RESPONSE_MS,
  PASSWORD_RESET_RESPONSE_JITTER_MS,
  registerLimiter,
  loginLimiter,
  passwordResetLimiter,
  testPharmacyPreviewLimiter,
  isTestAccountColumnAvailable,
  testPharmacyCache,
  setTestPharmacyCache,
  setIsTestAccountColumnAvailable,
  TEST_PHARMACY_CACHE_TTL_MS,
} from './auth-helpers';
import { normalizeEmail } from '../utils/email-utils';
import { evaluateRegistrationScreening } from '../services/registration-screening-service';
import { handoffToOpenClaw } from '../services/openclaw-service';

const router = Router();

const ONBOARDING_COOKIE_NAME = 'onboarding_token';

if (process.env.NODE_ENV !== 'test' && EXPOSE_PASSWORD_RESET_TOKEN) {
  throw new Error('EXPOSE_PASSWORD_RESET_TOKEN=true は test 環境でのみ許可されています');
}

// ---------------------------------------------------------------------------
// WorkOS AuthKit endpoints
// ---------------------------------------------------------------------------

// GET /auth/login — WorkOS AuthKit ログインURLを返す
router.get('/login', (_req: AuthRequest, res: Response) => {
  try {
    const url = getAuthorizationUrl('sign-in');
    res.json({ url });
  } catch (err) {
    handleRouteError(err, 'WorkOS login URL error', 'ログインURLの生成に失敗しました', res);
  }
});

// GET /auth/register — WorkOS AuthKit サインアップURLを返す
router.get('/register', (_req: AuthRequest, res: Response) => {
  try {
    const url = getAuthorizationUrl('sign-up');
    res.json({ url });
  } catch (err) {
    handleRouteError(err, 'WorkOS register URL error', '登録URLの生成に失敗しました', res);
  }
});

// GET /auth/callback — WorkOS AuthKit からのコールバック処理
router.get('/callback', async (req: AuthRequest, res: Response) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      res.status(400).json({ error: '認証コードがありません' });
      return;
    }
    assertJwtSecretConfigured();

    const authResult = await authenticateWithCode(code);
    const { pharmacy, isNewUser } = await findOrLinkPharmacy(authResult.user);

    if (isNewUser || !pharmacy) {
      // 新規ユーザー: WorkOS で認証済みだが薬局未登録
      // 専用 onboarding トークンを発行（通常のauth cookieとは別名）
      const onboardingToken = generateOnboardingToken({
        workosUserId: authResult.user.id,
        email: authResult.user.email,
      });
      res.cookie(ONBOARDING_COOKIE_NAME, onboardingToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000, // 30分
      });

      const clientBaseUrl = getClientBaseUrl();
      res.redirect(`${clientBaseUrl}/onboarding`);
      return;
    }

    // 既存ユーザー: ログイン処理
    if (!pharmacy.isActive) {
      const clientBaseUrl = getClientBaseUrl();
      if (pharmacy.verificationStatus === 'pending_verification') {
        res.redirect(`${clientBaseUrl}/verification-pending?email=${encodeURIComponent(pharmacy.email)}`);
        return;
      }
      res.redirect(`${clientBaseUrl}/login?error=inactive`);
      return;
    }

    const tokenPayload = buildTokenPayload(pharmacy);
    const token = generateToken(tokenPayload);
    invalidateAuthUserCache(pharmacy.id);

    setAuthCookie(res, token, process.env.NODE_ENV === 'production');
    setCsrfCookie(res, generateCsrfToken());

    const logAction = getLoginLogAction(pharmacy.isAdmin);
    void writeLog(logAction, {
      pharmacyId: pharmacy.id,
      detail: `WorkOS ログイン: ${pharmacy.name}`,
      ipAddress: getClientIp(req),
    });

    const clientBaseUrl = getClientBaseUrl();
    res.redirect(clientBaseUrl);
  } catch (err) {
    logger.error('WorkOS callback error', { error: getErrorMessage(err) });
    const clientBaseUrl = getClientBaseUrl();
    res.redirect(`${clientBaseUrl}/login?error=auth_failed`);
  }
});

// GET /auth/onboarding-info — Onboarding トークンからユーザー情報を返す
router.get('/onboarding-info', (req: AuthRequest, res: Response) => {
  const token = typeof req.cookies?.[ONBOARDING_COOKIE_NAME] === 'string' ? req.cookies[ONBOARDING_COOKIE_NAME] : '';
  if (!token) {
    res.status(401).json({ error: 'Onboardingセッションが無効です。再度ログインしてください' });
    return;
  }
  const claims = verifyOnboardingToken(token);
  if (!claims) {
    res.status(401).json({ error: 'Onboardingセッションが期限切れです。再度ログインしてください' });
    return;
  }
  res.json({ email: claims.email, workosUserId: claims.workosUserId });
});

// POST /auth/complete-registration — WorkOS認証済みユーザーの薬局情報登録
router.post('/complete-registration', registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    // C2修正: リクエストbodyではなくonboarding cookieからWorkOS情報を取得
    const onboardingToken = typeof req.cookies?.[ONBOARDING_COOKIE_NAME] === 'string' ? req.cookies[ONBOARDING_COOKIE_NAME] : '';
    const claims = verifyOnboardingToken(onboardingToken);
    if (!claims) {
      res.status(401).json({ error: 'Onboardingセッションが無効です。再度ログインしてください' });
      return;
    }
    const { workosUserId, email } = claims;

    // 入力バリデーション（email/password 以外の薬局情報）
    const validationErrors = validateOnboardingRegistration(req.body);
    if (validationErrors.length > 0) {
      res.status(400).json(buildValidationErrorResponse(validationErrors));
      return;
    }

    const {
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

    const { existingEmail, existingLicense } = await checkExistingPharmacy(normalizedEmail, licenseNumber);
    if (existingEmail) {
      res.status(409).json(buildEmailAlreadyRegisteredResponse());
      return;
    }
    if (existingLicense) {
      res.status(409).json(buildLicenseAlreadyRegisteredResponse());
      return;
    }

    // ジオコーディング
    const fullAddress = buildFullAddress(prefecture, address);
    const coords = await geocodeAddress(fullAddress);
    if (!coords) {
      res.status(400).json(buildInvalidAddressResponse());
      return;
    }

    // スクリーニング
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

    // WorkOS ユーザーなのでパスワードハッシュは不要 → null
    const registrationResult = await executeRegistrationProcess(
      normalizedEmail,
      null,
      name,
      normalizedPostalCode,
      prefecture,
      address,
      phone,
      fax,
      licenseNumber,
      permitLicenseNumber,
      permitPharmacyName,
      permitAddress,
      coords,
      screening,
    );

    if (!registrationResult.approved) {
      void writeLog('register', {
        detail: `失敗|phase=screening|reason=permit_mismatch|score=${screening.screeningScore}`,
        ipAddress: registrationIp,
      });
      res.status(403).json(buildRegistrationRejectionResponse(screening, registrationResult.reviewId));
      return;
    }

    const pharmacyId = registrationResult.pharmacyId;

    // WorkOS ユーザーIDを薬局に紐付け
    await db.update(pharmacies)
      .set({ workosUserId, updatedAt: new Date().toISOString() })
      .where(eq(pharmacies.id, pharmacyId));

    void writeLog('register', {
      pharmacyId,
      detail: `新規登録（WorkOS・審査待ち）: ${name}`,
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
    if (handleAuthConfigurationError('CompleteRegistration', err, res)) {
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

    handleRouteError(err, 'Complete registration error', '登録に失敗しました', res);
  }
});

// ---------------------------------------------------------------------------
// Legacy endpoints (maintained for backward compatibility during migration)
// ---------------------------------------------------------------------------

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
    const registrationResult = await executeRegistrationProcess(
      normalizedEmail,
      passwordHash,
      name,
      normalizedPostalCode,
      prefecture,
      address,
      phone,
      fax,
      licenseNumber,
      permitLicenseNumber,
      permitPharmacyName,
      permitAddress,
      coords,
      screening,
    );

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

    if (!pharmacy.passwordHash) {
      // WorkOS ユーザーはパスワードハッシュなし → WorkOS でログインを促す
      res.status(401).json({ error: 'このアカウントはWorkOS認証に移行済みです。WorkOSログインをご利用ください' });
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

router.post('/password-reset/request', passwordResetLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const requestStartedAt = Date.now();
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const validation = validatePasswordResetRequest(email);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const result = await createPasswordResetToken(email);
    await calculatePasswordResetDelay(requestStartedAt, PASSWORD_RESET_MIN_RESPONSE_MS, PASSWORD_RESET_RESPONSE_JITTER_MS);

    void writeLog('password_reset_request', {
      detail: 'パスワードリセット要求を受理',
      ipAddress: getClientIp(req),
    });

    res.json(buildPasswordResetResponse(SHOULD_EXPOSE_PASSWORD_RESET_TOKEN, result));
  } catch (err) {
    handleRouteError(err, 'Password reset request error', 'パスワードリセットに失敗しました', res);
  }
});

router.post('/password-reset/confirm', passwordResetLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const validation = validatePasswordResetConfirm(token, newPassword);
    if (!validation.valid) {
      if (validation.error === 'invalid_token') {
        res.status(400).json(buildInvalidResetTokenResponse());
      } else {
        res.status(400).json({ error: validation.error });
      }
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
    const rows = await loadAuthMeRows(req.user!.id, isTestAccountColumnAvailable, setIsTestAccountColumnAvailable);

    if (rows.length === 0) {
      res.status(404).json(buildUserNotFoundResponse());
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    if (handleDependencyServiceUnavailable(
      'Get me',
      err,
      res,
      'ユーザー情報を現在取得できません。しばらくしてから再試行してください',
    )) {
      return;
    }
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

    if (!includePassword && isCacheValid(testPharmacyCache)) {
      sendTestPharmacyResponse(res, testPharmacyCache!.rows, includePassword, cacheControlValue);
      return;
    }

    const rows = await loadTestPharmacyRows(res, setIsTestAccountColumnAvailable, includePassword);
    if (!rows) {
      return;
    }
    if (!includePassword) {
      setTestPharmacyCache({ expiresAt: Date.now() + TEST_PHARMACY_CACHE_TTL_MS, rows });
    }

    sendTestPharmacyResponse(res, rows, includePassword, cacheControlValue);
  } catch (err) {
    if (handleDependencyServiceUnavailable(
      'Get test pharmacies',
      err,
      res,
      'テスト薬局情報を現在取得できません。しばらくしてから再試行してください',
    )) {
      return;
    }
    handleRouteError(err, 'Get test pharmacies error', 'テスト薬局情報の取得に失敗しました', res, 503);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientBaseUrl(): string {
  if (process.env.CLIENT_URL) {
    return process.env.CLIENT_URL.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:5173';
}

export default router;
