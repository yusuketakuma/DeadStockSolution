import { Router, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  pharmacyBusinessHours,
  pharmacySpecialHours,
} from '../db/schema';
import { invalidateAuthUserCache } from '../middleware/auth';
import { processVerificationCallback } from '../services/pharmacy-verification-callback-service';
import {
  detectChangedReverificationFields,
  ReverificationTriggerError,
  sendReverificationTriggerErrorResponse,
  triggerReverification,
} from '../services/pharmacy-verification-service';
import { AuthRequest } from '../types';
import { geocodeAddress } from '../services/geocode-service';
import { writeLog, getClientIp } from '../services/log-service';
import { emailSchema } from '../utils/validators';
import { fetchBusinessHourSettings, validateBusinessHours, validateSpecialBusinessHours } from './business-hours';
import { adminWriteLimiter } from './admin-write-limiter';
import { parseIdOrBadRequest, handleAdminError } from './admin-utils';

function isValidVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 2_147_483_647;
}

const router = Router();

router.get('/pharmacies/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const rows = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    const { passwordHash: _, ...pharmacy } = rows[0];
    res.json(pharmacy);
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy detail error', '薬局情報の取得に失敗しました', res);
  }
});

router.get('/pharmacies/:id/business-hours/settings', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const data = await fetchBusinessHourSettings(id);
    res.json(data);
  } catch (err) {
    if (err instanceof Error && err.message === '薬局が見つかりません') {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }
    handleAdminError(err, 'Admin pharmacy business hour settings error', '営業時間設定の取得に失敗しました', res);
  }
});

router.put('/pharmacies/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  let latestVersion: number | null = null;
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const {
      email,
      name,
      postalCode,
      address,
      phone,
      fax,
      licenseNumber,
      prefecture,
      isActive,
      isTestAccount,
      testAccountPassword,
      version,
    } = req.body as Record<string, unknown>;

    if (!isValidVersion(version)) {
      res.status(400).json({ error: 'バージョン情報が不正です' });
      return;
    }

    const existingRows = await db.select({
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
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (existingRows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

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
      const normalizedPostalCode = postalCode.replace(/[-ー－\s]/g, '');
      if (!/^\d{7}$/.test(normalizedPostalCode)) {
        res.status(400).json({ error: '郵便番号は7桁の数字で入力してください' });
        return;
      }
      updates.postalCode = normalizedPostalCode;
    }

    if (address !== undefined) {
      if (typeof address !== 'string' || address.trim().length === 0 || address.trim().length > 255) {
        res.status(400).json({ error: '住所は1〜255文字で入力してください' });
        return;
      }
      updates.address = address.trim();
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

    if (licenseNumber !== undefined) {
      if (typeof licenseNumber !== 'string' || licenseNumber.trim().length === 0 || licenseNumber.trim().length > 50) {
        res.status(400).json({ error: '薬局開設許可番号が不正です' });
        return;
      }
      updates.licenseNumber = licenseNumber.trim();
    }

    if (prefecture !== undefined) {
      if (typeof prefecture !== 'string' || prefecture.trim().length === 0 || prefecture.trim().length > 10) {
        res.status(400).json({ error: '都道府県が不正です' });
        return;
      }
      updates.prefecture = prefecture.trim();
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: '有効状態フラグが不正です' });
        return;
      }
      updates.isActive = isActive;
    }

    if (isTestAccount !== undefined) {
      if (typeof isTestAccount !== 'boolean') {
        res.status(400).json({ error: 'テストアカウントフラグが不正です' });
        return;
      }
      updates.isTestAccount = isTestAccount;
    }

    if (testAccountPassword !== undefined) {
      if (typeof testAccountPassword !== 'string') {
        res.status(400).json({ error: 'テストアカウントの表示用パスワードが不正です' });
        return;
      }
      const normalizedTestAccountPassword = testAccountPassword.trim();
      if (normalizedTestAccountPassword.length > 100) {
        res.status(400).json({ error: 'テストアカウントの表示用パスワードは100文字以内で入力してください' });
        return;
      }
      updates.testAccountPassword = normalizedTestAccountPassword.length === 0
        ? null
        : normalizedTestAccountPassword;
    }

    if (updates.email !== undefined) {
      const existingEmailRows = await db.select({ id: pharmacies.id })
        .from(pharmacies)
        .where(eq(pharmacies.email, updates.email as string))
        .limit(1);

      if (existingEmailRows.length > 0 && existingEmailRows[0].id !== id) {
        res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
        return;
      }
    }

    if (updates.licenseNumber !== undefined) {
      const existingLicenseRows = await db.select({ id: pharmacies.id })
        .from(pharmacies)
        .where(eq(pharmacies.licenseNumber, updates.licenseNumber as string))
        .limit(1);

      if (existingLicenseRows.length > 0 && existingLicenseRows[0].id !== id) {
        res.status(409).json({ error: 'この薬局開設許可番号は既に登録されています' });
        return;
      }
    }

    if (address !== undefined || prefecture !== undefined) {
      const current = existingRows[0];
      const newPrefecture = (updates.prefecture as string) ?? current.prefecture;
      const newAddress = (updates.address as string) ?? current.address;
      const coords = await geocodeAddress(`${newPrefecture}${newAddress}`);
      if (!coords) {
        res.status(400).json({ error: '住所から位置情報を特定できませんでした。正しい住所を入力してください' });
        return;
      }
      updates.latitude = coords.lat;
      updates.longitude = coords.lng;
    }

    const current = existingRows[0];
    const nextIsTestAccount = typeof updates.isTestAccount === 'boolean'
      ? updates.isTestAccount
      : current.isTestAccount;
    const nextTestAccountPassword = updates.testAccountPassword !== undefined
      ? updates.testAccountPassword
      : current.testAccountPassword;
    if (nextIsTestAccount) {
      if (typeof nextTestAccountPassword !== 'string' || nextTestAccountPassword.trim().length === 0) {
        res.status(400).json({ error: 'テストアカウントには表示用パスワードを設定してください' });
        return;
      }
    } else {
      updates.testAccountPassword = null;
    }

    const changedReverificationFields = detectChangedReverificationFields(current, updates);
    const hasReverificationField = changedReverificationFields.length > 0;

    updates.updatedAt = new Date().toISOString();
    updates.version = sql`${pharmacies.version} + 1`;

    const updateResult = await db.update(pharmacies)
      .set(updates)
      .where(and(eq(pharmacies.id, id), eq(pharmacies.version, version)))
      .returning({
        id: pharmacies.id,
        version: pharmacies.version,
      });

    if (updateResult.length === 0) {
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
        isActive: pharmacies.isActive,
        isTestAccount: pharmacies.isTestAccount,
        testAccountPassword: pharmacies.testAccountPassword,
        verificationStatus: pharmacies.verificationStatus,
        verificationRequestId: pharmacies.verificationRequestId,
        version: pharmacies.version,
      })
        .from(pharmacies)
        .where(eq(pharmacies.id, id))
        .limit(1);
      if (latestRows.length === 0) {
        res.status(404).json({ error: '薬局が見つかりません' });
        return;
      }
      res.status(409).json({
        error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
        latestData: latestRows[0],
      });
      return;
    }

    latestVersion = updateResult[0]?.version ?? null;
    invalidateAuthUserCache(id);

    // 再認証トリガー: 対象フィールドが実際に変更された場合（isActive/isTestAccount 変更は対象外）
    if (hasReverificationField) {
      await triggerReverification(id, changedReverificationFields, {
        currentVerificationRequestId: current.verificationRequestId,
        triggeredBy: 'admin',
      });
    }

    void writeLog('account_update', {
      pharmacyId: req.user!.id,
      detail: hasReverificationField
        ? `管理者が薬局ID:${id}の基本情報を更新（再認証トリガー）`
        : `管理者が薬局ID:${id}の基本情報を更新`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '薬局情報を更新しました', version: updateResult[0].version });
  } catch (err) {
    if (err instanceof ReverificationTriggerError) {
      sendReverificationTriggerErrorResponse(
        res,
        '薬局情報は更新されましたが、再審査依頼の登録に失敗しました。時間をおいて再試行してください。',
        latestVersion,
      );
      return;
    }
    handleAdminError(err, 'Admin pharmacy update error', '薬局情報の更新に失敗しました', res);
  }
});

router.put('/pharmacies/:id/business-hours', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const weeklyResult = validateBusinessHours(req.body.hours);
    if ('error' in weeklyResult) {
      res.status(400).json({ error: weeklyResult.error });
      return;
    }

    const specialResult = validateSpecialBusinessHours(req.body.specialHours);
    if ('error' in specialResult) {
      res.status(400).json({ error: specialResult.error });
      return;
    }

    const version = req.body.version;
    if (!isValidVersion(version)) {
      res.status(400).json({ error: 'バージョン情報が不正です' });
      return;
    }

    const existsRows = await db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);
    if (existsRows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const versionUpdate = await tx.update(pharmacies)
        .set({
          version: sql`${pharmacies.version} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(pharmacies.id, id), eq(pharmacies.version, version)))
        .returning({ version: pharmacies.version });

      if (versionUpdate.length === 0) {
        return { conflict: true as const };
      }

      await tx.delete(pharmacyBusinessHours)
        .where(eq(pharmacyBusinessHours.pharmacyId, id));

      await tx.insert(pharmacyBusinessHours).values(
        weeklyResult.valid.map((h) => ({
          pharmacyId: id,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
          is24Hours: h.is24Hours,
        })),
      );

      if (specialResult.provided) {
        await tx.delete(pharmacySpecialHours)
          .where(eq(pharmacySpecialHours.pharmacyId, id));

        if (specialResult.valid.length > 0) {
          await tx.insert(pharmacySpecialHours).values(
            specialResult.valid.map((h) => ({
              pharmacyId: id,
              specialType: h.specialType,
              startDate: h.startDate,
              endDate: h.endDate,
              openTime: h.openTime,
              closeTime: h.closeTime,
              isClosed: h.isClosed,
              is24Hours: h.is24Hours,
              note: h.note,
              updatedAt: new Date().toISOString(),
            })),
          );
        }
      }

      return { conflict: false as const, newVersion: versionUpdate[0].version };
    });

    if (result.conflict) {
      const latestData = await fetchBusinessHourSettings(id);
      res.status(409).json({
        error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
        latestData,
      });
      return;
    }

    invalidateAuthUserCache(id);
    void writeLog('account_update', {
      pharmacyId: req.user!.id,
      detail: `管理者が薬局ID:${id}の営業時間を更新`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '営業時間を更新しました', version: result.newVersion });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy business hours update error', '営業時間の更新に失敗しました', res);
  }
});

router.put('/pharmacies/:id/toggle-active', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const rows = await db.select({ isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    await db.update(pharmacies)
      .set({
        isActive: !rows[0].isActive,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, id));
    invalidateAuthUserCache(id);

    void writeLog('admin_toggle_active', {
      pharmacyId: req.user!.id,
      detail: `薬局ID:${id}を${rows[0].isActive ? '無効' : '有効'}に変更`,
      ipAddress: getClientIp(req),
    });

    res.json({ message: `薬局を${rows[0].isActive ? '無効' : '有効'}にしました` });
  } catch (err) {
    handleAdminError(err, 'Admin toggle active error', '状態変更に失敗しました', res);
  }
});

router.post('/pharmacies/:id/verify', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const { approved, reason } = req.body;
    if (typeof approved !== 'boolean') {
      res.status(400).json({ error: 'approved (boolean) を指定してください' });
      return;
    }

    const result = await processVerificationCallback({
      pharmacyId: id,
      requestId: 0, // manual verification
      approved,
      reason: reason || (approved ? '管理者による手動承認' : '管理者による手動却下'),
    });

    invalidateAuthUserCache(id);
    void writeLog('admin_verify_pharmacy', {
      pharmacyId: req.user!.id,
      detail: `管理者が薬局ID:${id}を${approved ? '承認' : '却下'}`,
      ipAddress: getClientIp(req),
    });

    res.json({
      verificationStatus: result.verificationStatus,
      pharmacyId: result.pharmacyId,
    });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy verify error', '審査処理に失敗しました', res);
  }
});

export default router;
