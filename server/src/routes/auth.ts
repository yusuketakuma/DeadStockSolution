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
  validatePasswordResetRequest,
  validatePasswordResetConfirm,
  executeRegistrationProcess,
  EXPOSE_PASSWORD_RESET_TOKEN,
  SHOULD_EXPOSE_PASSWORD_RESET_TOKEN,
  PASSWORD_RESET_MIN_RESPONSE_MS,
  PASSWORD_RESET_RESPONSE_JITTER_MS,
  registerLimiter,
  loginLimiter,
  testPharmacyPreviewLimiter,
  isTestAccountColumnAvailable,
  testPharmacyCache,
  setTestPharmacyCache,
  setIsTestAccountColumnAvailable,
  TEST_PHARMACY_CACHE_TTL_MS,
  TEST_PHARMACY_PREVIEW_MAX_ACCOUNTS,
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

if (process.env.NODE_ENV !== 'test' && EXPOSE_PASSWORD_RESET_TOKEN) {
  throw new Error('EXPOSE_PASSWORD_RESET_TOKEN=true は test 環境でのみ許可されています');
}

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
    const validation = validatePasswordResetRequest(email);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
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

    const rows = await loadTestPharmacyRows(res, isTestAccountColumnAvailable, setIsTestAccountColumnAvailable);
    if (!rows) {
      return;
    }
    setTestPharmacyCache({ expiresAt: Date.now() + TEST_PHARMACY_CACHE_TTL_MS, rows });

    sendTestPharmacyResponse(res, rows, includePassword, cacheControlValue);
  } catch (err) {
    handleRouteError(err, 'Get test pharmacies error', 'テスト薬局情報の取得に失敗しました', res);
  }
});
export default router;
