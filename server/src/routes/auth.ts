import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
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

const router = Router();
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

function isTestPharmacyPreviewEnabled(): boolean {
  return process.env.ENABLE_TEST_PHARMACY_PREVIEW !== 'false';
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
let testPharmacyColumnsEnsured = false;

async function ensureTestPharmacyColumns(): Promise<boolean> {
  if (testPharmacyColumnsEnsured) {
    return true;
  }
  try {
    await db.execute(sql`ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "is_test_account" boolean DEFAULT false NOT NULL`);
    await db.execute(sql`ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "test_account_password" text`);
    testPharmacyColumnsEnsured = true;
    return true;
  } catch (err) {
    logger.error('Auto ensure test pharmacy columns failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

router.post('/register', registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validateRegistration(req.body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }
    assertJwtSecretConfigured();

    const { email, password, name, postalCode, address, phone, fax, licenseNumber, prefecture } = req.body;

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

    const result = await db.insert(pharmacies).values({
      email,
      passwordHash,
      name,
      postalCode: postalCode.replace(/[-ー－\s]/g, ''),
      address,
      phone,
      fax,
      licenseNumber,
      prefecture,
      latitude: coords.lat,
      longitude: coords.lng,
    }).returning({ id: pharmacies.id });

    const pharmacyId = result[0].id;

    const token = generateToken({
      id: pharmacyId,
      email,
      isAdmin: false,
      sessionVersion: deriveSessionVersion(passwordHash),
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });
    setCsrfCookie(res, generateCsrfToken());

    writeLog('register', { pharmacyId, detail: `新規登録: ${name}`, ipAddress: getClientIp(req) });

    res.status(201).json({
      id: pharmacyId,
      email,
      name,
      prefecture,
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

    logger.error('Registration error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

router.post('/login', loginLimiter, async (req: AuthRequest, res: Response) => {
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

    logger.error('Login error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

router.post('/password-reset/request', loginLimiter, async (req: AuthRequest, res: Response) => {
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
    logger.error('Password reset request error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'パスワードリセットに失敗しました' });
  }
});

router.post('/password-reset/confirm', loginLimiter, async (req: AuthRequest, res: Response) => {
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
    logger.error('Password reset confirm error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'パスワードリセットに失敗しました' });
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
    logger.error('Get me error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
  }
});

router.get('/test-pharmacies', testPharmacyPreviewLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    if (!isTestPharmacyPreviewEnabled()) {
      res.status(404).json({ error: 'テスト薬局情報は利用できません' });
      return;
    }
    if (isTestAccountColumnAvailable === false) {
      res.status(503).json({ error: 'テスト薬局機能のDBスキーマが未適用です。マイグレーションを実行してください' });
      return;
    }

    const rows = await (async () => {
      try {
        const currentRows = await db.select({
          id: pharmacies.id,
          name: pharmacies.name,
          email: pharmacies.email,
          prefecture: pharmacies.prefecture,
          password: pharmacies.testAccountPassword,
        })
          .from(pharmacies)
          .where(eq(pharmacies.isTestAccount, true))
          .orderBy(asc(pharmacies.id));
        isTestAccountColumnAvailable = true;
        return currentRows;
      } catch (err) {
        if (!isMissingTestPharmacyColumnError(err)) {
          throw err;
        }
        logger.warn('test pharmacy columns are missing; attempting auto-heal', {
          error: err instanceof Error ? err.message : String(err),
        });
        const ensured = await ensureTestPharmacyColumns();
        if (!ensured) {
          isTestAccountColumnAvailable = false;
          res.status(503).json({ error: 'テスト薬局機能のDBスキーマが未適用です。マイグレーションを実行してください' });
          return null;
        }
        const healedRows = await db.select({
          id: pharmacies.id,
          name: pharmacies.name,
          email: pharmacies.email,
          prefecture: pharmacies.prefecture,
          password: pharmacies.testAccountPassword,
        })
          .from(pharmacies)
          .where(eq(pharmacies.isTestAccount, true))
          .orderBy(asc(pharmacies.id));
        isTestAccountColumnAvailable = true;
        return healedRows;
      }
    })();
    if (!rows) {
      return;
    }

    res.json({
      accounts: rows.map((row) => ({
        ...row,
        password: row.password ?? '',
      })),
    });
  } catch (err) {
    logger.error('Get test pharmacies error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'テスト薬局情報の取得に失敗しました' });
  }
});

export default router;
