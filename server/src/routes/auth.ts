import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../services/auth-service';
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

router.post('/register', registerLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validateRegistration(req.body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

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

    const token = generateToken({ id: pharmacyId, email, isAdmin: false });

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
    logger.error('Login error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

router.post('/password-reset/request', loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
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

    // Always return success to prevent email enumeration
    writeLog('password_reset_request', {
      detail: 'パスワードリセット要求を受理',
      ipAddress: getClientIp(req),
    });

    res.json({
      message: 'パスワードリセットの手続きを受け付けました',
      // Token exposure should be explicitly enabled only in secured dev/test environments.
      ...(EXPOSE_PASSWORD_RESET_TOKEN && result ? { token: result.token } : {}),
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

    const success = await resetPasswordWithToken(token, newPassword);
    if (!success) {
      writeLog('password_reset_failed', { detail: 'リセットトークン無効または期限切れ', ipAddress: getClientIp(req) });
      res.status(400).json({ error: 'リセットトークンが無効または期限切れです' });
      return;
    }

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
    const rows = await db.select({
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

export default router;
