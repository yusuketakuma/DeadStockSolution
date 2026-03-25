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
import { eqEmailCaseInsensitive } from '../utils/email-utils';
import { emailSchema } from '../utils/validators';
import { sendBadRequest, sendConflict, sendNotFound } from './response-helpers';
import { invalidateActivePasswordResetTokens } from '../services/password-reset-service';
import { setAuthCookie } from './auth-helpers';
import inventorySearchRouter from './account-inventory-search';

// パスワード変更用レート制限: 10回/時/ユーザー
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req): string => `user:${(req as AuthRequest).user?.id ?? 'anonymous'}`,
  message: { error: 'アカウント更新の試行回数が多すぎます。しばらくして再試行してください' },
});

// アカウント削除用レート制限: 3回/日/ユーザー
const accountDeletionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req): string => `user:${(req as AuthRequest).user?.id ?? 'anonymous'}`,
  message: { error: 'アカウント削除の試行回数が多すぎます。しばらくして再試行してください' },
});

const router = Router();

router.use(inventorySearchRouter);

type AccountUpdates = Record<string, unknown>;
type PasswordRow = { passwordHash: string | null };
type ConflictLookupRow = { id: number };

function parseVersion(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 2_147_483_647) return null;
  return value;
}

function parseOptionalTrimmedString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) return null;
  return normalized;
}

async function selectFirst<T>(rowsPromise: PromiseLike<T[]>): Promise<T | null> {
  const rows = await rowsPromise;
  return rows[0] ?? null;
}

function sendAccountNotFound(res: Response): null {
  return sendNotFound(res, 'アカウントが見つかりません');
}

function assignOptionalTrimmedUpdate(
  updates: AccountUpdates,
  field: string,
  value: unknown,
  maxLength: number,
  errorMessage: string,
): string | null {
  const normalized = parseOptionalTrimmedString(value, maxLength);
  if (normalized === null) {
    return errorMessage;
  }
  if (normalized !== undefined) {
    updates[field] = normalized;
  }
  return null;
}

async function loadLatestAccountConflictData(pharmacyId: number): Promise<{
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  matchingAutoNotifyEnabled: boolean;
  version: number;
} | null> {
  return selectFirst(db.select({
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
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1));
}

async function loadAccountForView(pharmacyId: number): Promise<{
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
  matchingAutoNotifyEnabled: boolean;
  version: number;
  createdAt: string | null;
} | null> {
  return selectFirst(db.select({
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
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1));
}

async function loadAccountForUpdate(pharmacyId: number): Promise<{
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  isTestAccount: boolean;
  testAccountPassword: string | null;
  verificationRequestId: number | null;
} | null> {
  return selectFirst(db.select({
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
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1));
}

async function loadPasswordRow(pharmacyId: number): Promise<PasswordRow | null> {
  return selectFirst(db.select({ passwordHash: pharmacies.passwordHash })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1));
}

async function verifyCurrentPasswordForAccount(
  pharmacyId: number,
  currentPassword: unknown,
  res: Response,
  missingPasswordMessage: string,
): Promise<boolean> {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    sendBadRequest(res, missingPasswordMessage);
    return false;
  }

  const passwordRow = await loadPasswordRow(pharmacyId);
  if (!passwordRow) {
    sendAccountNotFound(res);
    return false;
  }

  if (!passwordRow.passwordHash) {
    sendBadRequest(res, 'パスワードが設定されていません。SSO でログインしてください');
    return false;
  }

  const valid = await verifyPassword(currentPassword, passwordRow.passwordHash);
  if (!valid) {
    sendBadRequest(res, '現在のパスワードが正しくありません');
    return false;
  }

  return true;
}

function isConflictWithAnotherAccount(rows: ConflictLookupRow[], pharmacyId: number): boolean {
  return rows.length > 0 && rows[0].id !== pharmacyId;
}

router.get('/', requireLogin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const account = await loadAccountForView(req.user!.id);

    if (!account) {
      sendAccountNotFound(res);
      return;
    }

    res.json(account);
  } catch (err) {
    logger.error('Get account error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: 'アカウント情報の取得に失敗しました' });
  }
});

router.put('/', requireLogin, passwordChangeLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
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
    const parsedVersion = parseVersion(version);
    if (parsedVersion === null) {
      sendBadRequest(res, 'バージョン情報が不正です');
      return;
    }

    const currentAccount = await loadAccountForUpdate(req.user!.id);
    if (!currentAccount) {
      sendAccountNotFound(res);
      return;
    }

    const updates: AccountUpdates = {};

    if (email !== undefined) {
      if (typeof email !== 'string') {
        sendBadRequest(res, 'メールアドレスが不正です');
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const parsedEmail = emailSchema.safeParse(normalizedEmail);
      if (!parsedEmail.success) {
        sendBadRequest(res, parsedEmail.error.issues[0]?.message ?? 'メールアドレスが不正です');
        return;
      }
      updates.email = normalizedEmail;
    }

    const nameError = assignOptionalTrimmedUpdate(updates, 'name', name, 100, '薬局名は1〜100文字で入力してください');
    if (nameError) {
      sendBadRequest(res, nameError);
      return;
    }

    if (postalCode !== undefined) {
      if (typeof postalCode !== 'string') {
        sendBadRequest(res, '郵便番号が不正です');
        return;
      }
      const normalized = postalCode.replace(/[-ー－\s]/g, '');
      if (!/^\d{7}$/.test(normalized)) {
        sendBadRequest(res, '郵便番号は7桁の数字で入力してください');
        return;
      }
      updates.postalCode = normalized;
    }

    const addressError = assignOptionalTrimmedUpdate(updates, 'address', address, 255, '住所は1〜255文字で入力してください');
    if (addressError) {
      sendBadRequest(res, addressError);
      return;
    }

    const phoneError = assignOptionalTrimmedUpdate(updates, 'phone', phone, 30, '電話番号が不正です');
    if (phoneError) {
      sendBadRequest(res, phoneError);
      return;
    }

    const faxError = assignOptionalTrimmedUpdate(updates, 'fax', fax, 30, 'FAX番号が不正です');
    if (faxError) {
      sendBadRequest(res, faxError);
      return;
    }

    const prefectureError = assignOptionalTrimmedUpdate(updates, 'prefecture', prefecture, 10, '都道府県が不正です');
    if (prefectureError) {
      sendBadRequest(res, prefectureError);
      return;
    }

    // 住所または都道府県が変更された場合、再ジオコーディング
    if (address !== undefined || prefecture !== undefined) {
      const newPrefecture = (updates.prefecture as string) ?? currentAccount.prefecture;
      const newAddress = (updates.address as string) ?? currentAccount.address;
      const fullAddress = `${newPrefecture}${newAddress}`;
      const coords = await geocodeAddress(fullAddress);
      if (!coords) {
        sendBadRequest(res, '住所から位置情報を特定できませんでした。正しい住所を入力してください');
        return;
      }
      updates.latitude = coords.lat;
      updates.longitude = coords.lng;
    }

    const licenseNumberError = assignOptionalTrimmedUpdate(
      updates,
      'licenseNumber',
      licenseNumber,
      50,
      '薬局開設許可番号が不正です',
    );
    if (licenseNumberError) {
      sendBadRequest(res, licenseNumberError);
      return;
    }

    if (testAccountPassword !== undefined) {
      if (!currentAccount.isTestAccount) {
        sendBadRequest(res, 'テストアカウントではないため表示用パスワードは設定できません');
        return;
      }
      if (typeof testAccountPassword !== 'string') {
        sendBadRequest(res, 'テストアカウントの表示用パスワードが不正です');
        return;
      }
      const normalizedTestAccountPassword = testAccountPassword.trim();
      if (normalizedTestAccountPassword.length === 0 || normalizedTestAccountPassword.length > 100) {
        sendBadRequest(res, 'テストアカウントの表示用パスワードは1〜100文字で入力してください');
        return;
      }
      updates.testAccountPassword = normalizedTestAccountPassword;
    }

    if (matchingAutoNotifyEnabled !== undefined) {
      if (typeof matchingAutoNotifyEnabled !== 'boolean') {
        sendBadRequest(res, '通知設定の値が不正です');
        return;
      }
      updates.matchingAutoNotifyEnabled = matchingAutoNotifyEnabled;
    }

    const [existingEmailRows, existingLicenseRows] = await Promise.all([
      updates.email !== undefined
        ? db.select({ id: pharmacies.id })
          .from(pharmacies)
          .where(eqEmailCaseInsensitive(pharmacies.email, updates.email as string))
          .limit(1)
        : Promise.resolve([]),
      updates.licenseNumber !== undefined
        ? db.select({ id: pharmacies.id })
          .from(pharmacies)
          .where(eq(pharmacies.licenseNumber, updates.licenseNumber as string))
          .limit(1)
        : Promise.resolve([]),
    ]);

    if (isConflictWithAnotherAccount(existingEmailRows as ConflictLookupRow[], req.user!.id)) {
      sendConflict(res, 'このメールアドレスは既に登録されています');
      return;
    }

    if (isConflictWithAnotherAccount(existingLicenseRows as ConflictLookupRow[], req.user!.id)) {
      sendConflict(res, 'この薬局開設許可番号は既に登録されています');
      return;
    }

    if (newPassword !== undefined && newPassword !== '') {
      if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 100) {
        sendBadRequest(res, '新しいパスワードは8〜100文字で入力してください');
        return;
      }

      const isCurrentPasswordValid = await verifyCurrentPasswordForAccount(
        req.user!.id,
        currentPassword,
        res,
        '現在のパスワードを入力してください',
      );
      if (!isCurrentPasswordValid) {
        return;
      }

      updates.passwordHash = await hashPassword(newPassword);
    }

    if (currentAccount.isTestAccount) {
      const nextTestAccountPassword = updates.testAccountPassword !== undefined
        ? updates.testAccountPassword
        : currentAccount.testAccountPassword;
      if (typeof nextTestAccountPassword !== 'string' || nextTestAccountPassword.trim().length === 0) {
        sendBadRequest(res, 'テストアカウントには表示用パスワードの設定が必要です');
        return;
      }
    }

    const changedReverificationFields = detectChangedReverificationFields(currentAccount, updates);
    const hasReverificationField = changedReverificationFields.length > 0;

    updates.updatedAt = new Date().toISOString();
    // version をインクリメント
    updates.version = sql`${pharmacies.version} + 1`;

    // 楽観的ロック: id と version の両方が一致する場合のみ更新
    const passwordChanged = typeof updates.passwordHash === 'string';
    const updateTimestamp = String(updates.updatedAt);
    const updateResult = await db.transaction(async (tx): Promise<Array<{
      id: number;
      email: string;
      isAdmin: boolean | null;
      isActive: boolean | null;
      passwordHash: string | null;
      workosUserId: string | null;
      version: number;
    }>> => {
      const rows = await tx.update(pharmacies)
        .set(updates)
        .where(and(eq(pharmacies.id, req.user!.id), eq(pharmacies.version, parsedVersion)))
        .returning({
          id: pharmacies.id,
          email: pharmacies.email,
          isAdmin: pharmacies.isAdmin,
          isActive: pharmacies.isActive,
          passwordHash: pharmacies.passwordHash,
          workosUserId: pharmacies.workosUserId,
          version: pharmacies.version,
        });

      if (rows.length > 0 && passwordChanged) {
        await invalidateActivePasswordResetTokens(tx, req.user!.id, updateTimestamp);
      }

      return rows;
    });

    // 更新行数 0 = 楽観的ロック競合
    if (updateResult.length === 0) {
      const latestAccount = await loadLatestAccountConflictData(req.user!.id);

      res.status(409).json({
        error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
        latestData: latestAccount,
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
    const { passwordHash: ph, workosUserId: wid } = updatedPharmacy;
    const token = generateToken({
      id: updatedPharmacy.id,
      email: updatedPharmacy.email,
      isAdmin: updatedPharmacy.isAdmin ?? false,
      sessionVersion: ph ? deriveSessionVersion(ph) : `workos:${wid ?? ''}`,
    });

    setAuthCookie(res, token, process.env.NODE_ENV === 'production');

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

router.delete('/', requireLogin, accountDeletionLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string'
      ? req.body.currentPassword
      : '';

    const isCurrentPasswordValid = await verifyCurrentPasswordForAccount(
      req.user!.id,
      currentPassword,
      res,
      '退会には現在のパスワードが必要です',
    );
    if (!isCurrentPasswordValid) {
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
