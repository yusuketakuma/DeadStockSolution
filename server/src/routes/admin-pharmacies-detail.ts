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
import { writeLog, getClientIp } from '../services/log-service';
import { fetchBusinessHourSettings, validateBusinessHours, validateSpecialBusinessHours } from './business-hours';
import { adminWriteLimiter } from './admin-write-limiter';
import { parseIdOrBadRequest, handleAdminError } from './admin-utils';
import {
  PHARMACY_NOT_FOUND_ERROR,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  parseVersionOrSendError,
  sendPharmacyNotFound,
  sendOptimisticLockConflict,
  fetchPharmacyForUpdate,
  fetchLatestPharmacyConflict,
  pharmacyExists,
  preparePharmacyUpdatePayload,
} from './admin-pharmacies-detail-helpers';

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
      sendPharmacyNotFound(res);
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
    if (err instanceof Error && err.message === PHARMACY_NOT_FOUND_ERROR) {
      sendPharmacyNotFound(res);
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

    const body = req.body as Record<string, unknown>;
    const version = parseVersionOrSendError(res, body.version);
    if (version === null) return;

    const current = await fetchPharmacyForUpdate(id);
    if (!current) {
      sendPharmacyNotFound(res);
      return;
    }

    const preparedUpdates = await preparePharmacyUpdatePayload(id, current, body);
    if (!preparedUpdates.ok) {
      res.status(preparedUpdates.status).json({ error: preparedUpdates.error });
      return;
    }

    const updates = preparedUpdates.value;
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
      const latestData = await fetchLatestPharmacyConflict(id);
      if (!latestData) {
        sendPharmacyNotFound(res);
        return;
      }
      sendOptimisticLockConflict(res, latestData);
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

    const version = parseVersionOrSendError(res, req.body.version);
    if (version === null) return;

    if (!await pharmacyExists(id)) {
      sendPharmacyNotFound(res);
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
      sendOptimisticLockConflict(res, latestData);
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
      sendPharmacyNotFound(res);
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
