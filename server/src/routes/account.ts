import { Router, Response } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { deriveSessionVersion, hashPassword, verifyPassword, generateToken } from '../services/auth-service';
import { requireLogin, invalidateAuthUserCache } from '../middleware/auth';
import { geocodeAddress } from '../services/geocode-service';
import {
  detectChangedReverificationFields,
  ReverificationTriggerError,
  sendReverificationTriggerErrorResponse,
  triggerReverification,
} from '../services/pharmacy-verification-service';
import { AuthRequest } from '../types';
import { clearCsrfCookie } from '../middleware/csrf';
import { writeLog, getClientIp } from '../services/log-service';
import { logger } from '../services/logger';
import { getErrorMessage } from '../middleware/error-handler';
import { emailSchema } from '../utils/validators';

// パスワード変更用レート制限: 10回/時/ユーザー
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${(req as AuthRequest).user?.id ?? 'anonymous'}`,
  message: { error: 'アカウント更新の試行回数が多すぎます。しばらくして再試行してください' },
});

// アカウント削除用レート制限: 3回/日/ユーザー
const accountDeletionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${(req as AuthRequest).user?.id ?? 'anonymous'}`,
  message: { error: 'アカウント削除の試行回数が多すぎます。しばらくして再試行してください' },
});

const router = Router();

router.get('/', requireLogin, async (req: AuthRequest, res: Response) => {
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
      isTestAccount: pharmacies.isTestAccount,
      matchingAutoNotifyEnabled: pharmacies.matchingAutoNotifyEnabled,
      version: pharmacies.version,
      createdAt: pharmacies.createdAt,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'アカウントが見つかりません' });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error('Get account error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: 'アカウント情報の取得に失敗しました' });
  }
});

router.put('/', requireLogin, passwordChangeLimiter, async (req: AuthRequest, res: Response) => {
  let latestVersion: number | null = null;
  try {
    const {
      email,
      name,
      postalCode,
      address,
      phone,
      fax,
      prefecture,
      licenseNumber,
      currentPassword,
      newPassword,
      testAccountPassword,
      matchingAutoNotifyEnabled,
      version,
    } = req.body;

    // version バリデーション
    if (version === undefined || version === null || typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 2_147_483_647) {
      res.status(400).json({ error: 'バージョン情報が不正です' });
      return;
    }

    const accountRows = await db.select({
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
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);
    if (accountRows.length === 0) {
      res.status(404).json({ error: 'アカウントが見つかりません' });
      return;
    }
    const currentAccount = accountRows[0];

    const updates: Record<string, unknown> = {};

    if (email !== undefined) {
      if (typeof email !== 'string') {
        res.status(400).json({ error: 'メールアドレスが不正です' });
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const parsedEmail = emailSchema.safeParse(normalizedEmail);
      if (!parsedEmail.success) {
        res.status(400).json({ error: parsedEmail.error.issues[0]?.message ?? 'メールアドレスが不正です' });
        return;
      }
      updates.email = normalizedEmail;
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
        res.status(400).json({ error: '薬局名は1〜100文字で入力してください' });
        return;
      }
      updates.name = name.trim();
    }

    if (postalCode !== undefined) {
      if (typeof postalCode !== 'string') {
        res.status(400).json({ error: '郵便番号が不正です' });
        return;
      }
      const normalized = postalCode.replace(/[-ー－\s]/g, '');
      if (!/^\d{7}$/.test(normalized)) {
        res.status(400).json({ error: '郵便番号は7桁の数字で入力してください' });
        return;
      }
      updates.postalCode = normalized;
    }

    if (address !== undefined) {
      if (typeof address !== 'string' || address.trim().length === 0 || address.trim().length > 255) {
        res.status(400).json({ error: '住所は1〜255文字で入力してください' });
        return;
      }
      updates.address = address.trim();
    }

    // 住所または都道府県が変更された場合、再ジオコーディング
    if (address !== undefined || prefecture !== undefined) {
      const newPrefecture = (updates.prefecture as string) ?? currentAccount.prefecture;
      const newAddress = (updates.address as string) ?? currentAccount.address;
      const fullAddress = `${newPrefecture}${newAddress}`;
      const coords = await geocodeAddress(fullAddress);
      if (!coords) {
        res.status(400).json({ error: '住所から位置情報を特定できませんでした。正しい住所を入力してください' });
        return;
      }
      updates.latitude = coords.lat;
      updates.longitude = coords.lng;
    }

    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.trim().length === 0 || phone.trim().length > 30) {
        res.status(400).json({ error: '電話番号が不正です' });
        return;
      }
      updates.phone = phone.trim();
    }

    if (fax !== undefined) {
      if (typeof fax !== 'string' || fax.trim().length === 0 || fax.trim().length > 30) {
        res.status(400).json({ error: 'FAX番号が不正です' });
        return;
      }
      updates.fax = fax.trim();
    }

    if (prefecture !== undefined) {
      if (typeof prefecture !== 'string' || prefecture.trim().length === 0 || prefecture.trim().length > 10) {
        res.status(400).json({ error: '都道府県が不正です' });
        return;
      }
      updates.prefecture = prefecture.trim();
    }

    if (licenseNumber !== undefined) {
      if (typeof licenseNumber !== 'string' || licenseNumber.trim().length === 0 || licenseNumber.trim().length > 50) {
        res.status(400).json({ error: '薬局開設許可番号が不正です' });
        return;
      }
      updates.licenseNumber = licenseNumber.trim();
    }

    if (testAccountPassword !== undefined) {
      if (!currentAccount.isTestAccount) {
        res.status(400).json({ error: 'テストアカウントではないため表示用パスワードは設定できません' });
        return;
      }
      if (typeof testAccountPassword !== 'string') {
        res.status(400).json({ error: 'テストアカウントの表示用パスワードが不正です' });
        return;
      }
      const normalizedTestAccountPassword = testAccountPassword.trim();
      if (normalizedTestAccountPassword.length === 0 || normalizedTestAccountPassword.length > 100) {
        res.status(400).json({ error: 'テストアカウントの表示用パスワードは1〜100文字で入力してください' });
        return;
      }
      updates.testAccountPassword = normalizedTestAccountPassword;
    }

    if (matchingAutoNotifyEnabled !== undefined) {
      if (typeof matchingAutoNotifyEnabled !== 'boolean') {
        res.status(400).json({ error: '通知設定の値が不正です' });
        return;
      }
      updates.matchingAutoNotifyEnabled = matchingAutoNotifyEnabled;
    }

    const [existingEmailRows, existingLicenseRows] = await Promise.all([
      updates.email !== undefined
        ? db.select({ id: pharmacies.id })
          .from(pharmacies)
          .where(eq(pharmacies.email, updates.email as string))
          .limit(1)
        : Promise.resolve([]),
      updates.licenseNumber !== undefined
        ? db.select({ id: pharmacies.id })
          .from(pharmacies)
          .where(eq(pharmacies.licenseNumber, updates.licenseNumber as string))
          .limit(1)
        : Promise.resolve([]),
    ]);

    if (existingEmailRows.length > 0 && existingEmailRows[0].id !== req.user!.id) {
      res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
      return;
    }

    if (existingLicenseRows.length > 0 && existingLicenseRows[0].id !== req.user!.id) {
      res.status(409).json({ error: 'この薬局開設許可番号は既に登録されています' });
      return;
    }

    if (newPassword !== undefined && newPassword !== '') {
      if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 100) {
        res.status(400).json({ error: '新しいパスワードは8〜100文字で入力してください' });
        return;
      }

      if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
        res.status(400).json({ error: '現在のパスワードを入力してください' });
        return;
      }

      const rows = await db.select({ passwordHash: pharmacies.passwordHash })
        .from(pharmacies)
        .where(eq(pharmacies.id, req.user!.id))
        .limit(1);
      if (rows.length === 0) {
        res.status(404).json({ error: 'アカウントが見つかりません' });
        return;
      }

      const valid = await verifyPassword(currentPassword, rows[0].passwordHash);
      if (!valid) {
        res.status(400).json({ error: '現在のパスワードが正しくありません' });
        return;
      }

      updates.passwordHash = await hashPassword(newPassword);
      if (currentAccount.isTestAccount) {
        updates.testAccountPassword = newPassword;
      }
    }

    if (currentAccount.isTestAccount) {
      const nextTestAccountPassword = updates.testAccountPassword !== undefined
        ? updates.testAccountPassword
        : currentAccount.testAccountPassword;
      if (typeof nextTestAccountPassword !== 'string' || nextTestAccountPassword.trim().length === 0) {
        res.status(400).json({ error: 'テストアカウントには表示用パスワードの設定が必要です' });
        return;
      }
    }

    const changedReverificationFields = detectChangedReverificationFields(currentAccount, updates);
    const hasReverificationField = changedReverificationFields.length > 0;

    updates.updatedAt = new Date().toISOString();
    // version をインクリメント
    updates.version = sql`${pharmacies.version} + 1`;

    // 楽観的ロック: id と version の両方が一致する場合のみ更新
    const updateResult = await db.update(pharmacies)
      .set(updates)
      .where(and(eq(pharmacies.id, req.user!.id), eq(pharmacies.version, version)))
      .returning({
        id: pharmacies.id,
        email: pharmacies.email,
        isAdmin: pharmacies.isAdmin,
        isActive: pharmacies.isActive,
        passwordHash: pharmacies.passwordHash,
        version: pharmacies.version,
      });

    // 更新行数 0 = 楽観的ロック競合
    if (updateResult.length === 0) {
      // 最新データを取得して 409 レスポンスに含める
      const latestRows = await db.select({
        id: pharmacies.id,
        email: pharmacies.email,
        name: pharmacies.name,
        postalCode: pharmacies.postalCode,
        address: pharmacies.address,
        phone: pharmacies.phone,
        fax: pharmacies.fax,
        licenseNumber: pharmacies.licenseNumber,
        prefecture: pharmacies.prefecture,
        matchingAutoNotifyEnabled: pharmacies.matchingAutoNotifyEnabled,
        version: pharmacies.version,
      })
        .from(pharmacies)
        .where(eq(pharmacies.id, req.user!.id))
        .limit(1);

      res.status(409).json({
        error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
        latestData: latestRows[0] ?? null,
      });
      return;
    }

    const updatedPharmacy = updateResult[0];
    latestVersion = updatedPharmacy?.version ?? null;
    invalidateAuthUserCache(req.user!.id);

    if (!updatedPharmacy || !updatedPharmacy.isActive) {
      res.clearCookie('token');
      res.status(401).json({ error: 'アカウントが無効です。再度ログインしてください' });
      return;
    }

    // Regenerate token from current DB state
    const token = generateToken({
      id: updatedPharmacy.id,
      email: updatedPharmacy.email,
      isAdmin: updatedPharmacy.isAdmin ?? false,
      sessionVersion: deriveSessionVersion(updatedPharmacy.passwordHash),
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    // 再認証トリガー: 対象フィールドが実際に変更された場合のみ
    if (hasReverificationField) {
      await triggerReverification(req.user!.id, changedReverificationFields, {
        currentVerificationRequestId: currentAccount.verificationRequestId,
      });
    }

    void writeLog('account_update', {
      pharmacyId: req.user!.id,
      detail: hasReverificationField ? 'アカウント情報を更新（再認証トリガー）' : 'アカウント情報を更新',
      ipAddress: getClientIp(req),
    });

    res.json({
      message: hasReverificationField
        ? 'アカウント情報を更新しました。プロフィール変更のため再審査を行います。'
        : 'アカウント情報を更新しました',
      version: updatedPharmacy.version,
      ...(hasReverificationField ? { verificationStatus: 'pending_verification' } : {}),
    });
  } catch (err) {
    if (err instanceof ReverificationTriggerError) {
      sendReverificationTriggerErrorResponse(
        res,
        'アカウント情報は更新されましたが、再審査依頼の登録に失敗しました。時間をおいて再試行してください。',
        latestVersion,
      );
      return;
    }
    logger.error('Update account error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: 'アカウント更新に失敗しました' });
  }
});

router.delete('/', requireLogin, accountDeletionLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string'
      ? req.body.currentPassword
      : '';
    if (!currentPassword) {
      res.status(400).json({ error: '退会には現在のパスワードが必要です' });
      return;
    }

    const rows = await db.select({ passwordHash: pharmacies.passwordHash })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'アカウントが見つかりません' });
      return;
    }

    const valid = await verifyPassword(currentPassword, rows[0].passwordHash);
    if (!valid) {
      res.status(400).json({ error: '現在のパスワードが正しくありません' });
      return;
    }

    await db.update(pharmacies)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(pharmacies.id, req.user!.id));
    invalidateAuthUserCache(req.user!.id);

    res.clearCookie('token');
    clearCsrfCookie(res);
    void writeLog('account_deactivate', {
      pharmacyId: req.user!.id,
      detail: 'アカウントを無効化',
      ipAddress: getClientIp(req),
    });
    res.json({ message: 'アカウントを無効化しました' });
  } catch (err) {
    logger.error('Delete account error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: 'アカウント削除に失敗しました' });
  }
});

export default router;
