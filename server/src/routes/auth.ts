import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { hashPassword, verifyPassword, generateToken } from '../services/auth-service';
import { ensureTestAccount, getTestAccountByKey } from '../services/test-account-service';
import { validateRegistration, validateLogin } from '../utils/validators';
import { postalCodeToCoordinates } from '../utils/postal-code';
import { AuthRequest } from '../types';
import { requireLogin } from '../middleware/auth';

const router = Router();
const isTestAccountLoginEnabled = process.env.ENABLE_TEST_ACCOUNT_LOGIN !== 'false';
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
    const coords = postalCodeToCoordinates(postalCode);

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
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    }).returning({ id: pharmacies.id });

    const pharmacyId = result[0].id;

    const token = generateToken({ id: pharmacyId, email, isAdmin: false });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      id: pharmacyId,
      email,
      name,
      prefecture,
    });
  } catch (err) {
    console.error('Registration error:', err);
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
      res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
      return;
    }

    const token = generateToken({
      id: pharmacy.id,
      email: pharmacy.email,
      isAdmin: pharmacy.isAdmin ?? false,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      id: pharmacy.id,
      email: pharmacy.email,
      name: pharmacy.name,
      prefecture: pharmacy.prefecture,
      isAdmin: pharmacy.isAdmin,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

router.post('/test-login', loginLimiter, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTestAccountLoginEnabled) {
      res.status(403).json({ error: 'テストログインは無効です' });
      return;
    }

    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const account = getTestAccountByKey(key);
    if (!account) {
      res.status(400).json({ error: '不正なテストアカウントです' });
      return;
    }

    const user = await ensureTestAccount(account);
    const token = generateToken({
      id: user.id,
      email: user.email,
      isAdmin: false,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json(user);
  } catch (err) {
    console.error('Test login error:', err);
    res.status(500).json({ error: 'テストログインに失敗しました' });
  }
});

router.post('/logout', (_req: AuthRequest, res: Response) => {
  res.clearCookie('token');
  res.json({ message: 'ログアウトしました' });
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
    console.error('Get me error:', err);
    res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
  }
});

export default router;
