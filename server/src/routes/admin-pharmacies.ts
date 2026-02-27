import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  pharmacyBusinessHours,
  pharmacySpecialHours,
  exchangeProposals,
  exchangeHistory,
  adminMessages,
  userRequests,
  proposalComments,
} from '../db/schema';
import { invalidateAuthUserCache } from '../middleware/auth';
import { AuthRequest } from '../types';
import { geocodeAddress } from '../services/geocode-service';
import { parsePositiveInt } from '../utils/request-utils';
import { isSafeInternalPath, sanitizeInternalPath } from '../utils/path-utils';
import { rowCount } from '../utils/db-utils';
import { writeLog, getClientIp } from '../services/log-service';
import { logger } from '../services/logger';
import { emailSchema } from '../utils/validators';
import { buildOpenClawLogContext } from '../services/openclaw-log-context-service';
import {
  getOpenClawImplementationBranch,
  handoffToOpenClaw,
  isOpenClawConnectorConfigured,
  isOpenClawWebhookConfigured,
  type OpenClawHandoffResult,
} from '../services/openclaw-service';
import { fetchBusinessHourSettings, validateBusinessHours, validateSpecialBusinessHours } from './business-hours';
import { sendPaginated, parseListPagination, parseIdOrBadRequest, getErrorMessage, handleAdminError } from './admin-utils';

const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '管理系APIへのリクエストが多すぎます。しばらくして再試行してください' },
});

type AdminHandoffResponse = Pick<
  OpenClawHandoffResult,
  'accepted' | 'connectorConfigured' | 'implementationBranch' | 'status' | 'note'
>;

async function collectAdminHandoffContext(
  pharmacyId: number,
  requestId: number,
): Promise<Record<string, unknown> | undefined> {
  try {
    const operationLogs = await buildOpenClawLogContext(pharmacyId);
    return { operationLogs };
  } catch (contextErr) {
    logger.warn('OpenClaw context collection failed on admin handoff', {
      requestId,
      pharmacyId,
      error: getErrorMessage(contextErr),
    });
    return undefined;
  }
}

function buildAdminHandoffResponse(handoff: OpenClawHandoffResult): AdminHandoffResponse {
  return {
    accepted: handoff.accepted,
    connectorConfigured: handoff.connectorConfigured,
    implementationBranch: handoff.implementationBranch,
    status: handoff.status,
    note: handoff.note,
  };
}

function sendAdminHandoffResponse(res: Response, handoff: OpenClawHandoffResult): void {
  const handoffPayload = buildAdminHandoffResponse(handoff);
  if (handoff.accepted) {
    res.json({
      message: 'OpenClawへ再連携しました',
      handoff: handoffPayload,
    });
    return;
  }

  res.status(202).json({
    message: 'OpenClaw連携は保留中です',
    handoff: handoffPayload,
  });
}

function isValidVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 2_147_483_647;
}

const router = Router();

router.get('/pharmacies/options', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      isActive: pharmacies.isActive,
      isTestAccount: pharmacies.isTestAccount,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.createdAt));

    res.json({
      data: rows,
    });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy options error', '薬局候補の取得に失敗しました', res);
  }
});

router.get('/pharmacies', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      isActive: pharmacies.isActive,
      isAdmin: pharmacies.isAdmin,
      isTestAccount: pharmacies.isTestAccount,
      createdAt: pharmacies.createdAt,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(pharmacies);

    sendPaginated(res, rows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin pharmacies error', '薬局一覧の取得に失敗しました', res);
  }
});

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
      version,
    } = req.body as Record<string, unknown>;

    if (!isValidVersion(version)) {
      res.status(400).json({ error: 'バージョン情報が不正です' });
      return;
    }

    const existingRows = await db.select({
      id: pharmacies.id,
      address: pharmacies.address,
      prefecture: pharmacies.prefecture,
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
      const latestRows = await db.select()
        .from(pharmacies)
        .where(eq(pharmacies.id, id))
        .limit(1);
      const latest = latestRows[0];
      if (!latest) {
        res.status(404).json({ error: '薬局が見つかりません' });
        return;
      }
      const { passwordHash: _, ...latestData } = latest;
      res.status(409).json({
        error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
        latestData,
      });
      return;
    }

    invalidateAuthUserCache(id);
    void writeLog('account_update', {
      pharmacyId: req.user!.id,
      detail: `管理者が薬局ID:${id}の基本情報を更新`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '薬局情報を更新しました', version: updateResult[0].version });
  } catch (err) {
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

    writeLog('admin_toggle_active', {
      pharmacyId: req.user!.id,
      detail: `薬局ID:${id}を${rows[0].isActive ? '無効' : '有効'}に変更`,
      ipAddress: getClientIp(req),
    });

    res.json({ message: `薬局を${rows[0].isActive ? '無効' : '有効'}にしました` });
  } catch (err) {
    handleAdminError(err, 'Admin toggle active error', '状態変更に失敗しました', res);
  }
});

router.get('/exchanges', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select()
      .from(exchangeProposals)
      .orderBy(desc(exchangeProposals.proposedAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(exchangeProposals);

    sendPaginated(res, rows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin exchanges error', '交換一覧の取得に失敗しました', res);
  }
});

router.get('/exchanges/:proposalId/comments', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parseIdOrBadRequest(res, req.params.proposalId);
    if (!proposalId) return;

    const proposalRows = await db.select({ id: exchangeProposals.id })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);
    if (proposalRows.length === 0) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    const rows = await db.select({
      id: proposalComments.id,
      proposalId: proposalComments.proposalId,
      authorPharmacyId: proposalComments.authorPharmacyId,
      authorName: pharmacies.name,
      body: proposalComments.body,
      isDeleted: proposalComments.isDeleted,
      createdAt: proposalComments.createdAt,
      updatedAt: proposalComments.updatedAt,
    })
      .from(proposalComments)
      .innerJoin(pharmacies, eq(proposalComments.authorPharmacyId, pharmacies.id))
      .where(eq(proposalComments.proposalId, proposalId))
      .orderBy(desc(proposalComments.createdAt), desc(proposalComments.id));

    res.json({
      data: rows.map((row) => ({
        ...row,
        body: row.isDeleted ? '（削除済み）' : row.body,
      })),
    });
  } catch (err) {
    handleAdminError(err, 'Admin exchange comments error', '交渉メモの取得に失敗しました', res);
  }
});

router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: exchangeHistory.id,
      proposalId: exchangeHistory.proposalId,
      pharmacyAId: exchangeHistory.pharmacyAId,
      pharmacyBId: exchangeHistory.pharmacyBId,
      totalValue: exchangeHistory.totalValue,
      completedAt: exchangeHistory.completedAt,
    })
      .from(exchangeHistory)
      .orderBy(desc(exchangeHistory.completedAt))
      .limit(limit)
      .offset(offset);

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({
        id: pharmacies.id,
        name: pharmacies.name,
      })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];

    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));
    const [total] = await db.select({ count: rowCount }).from(exchangeHistory);

    const mappedRows = rows.map((row) => ({
      ...row,
      pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
      pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
    }));
    sendPaginated(res, mappedRows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin history error', '交換履歴の取得に失敗しました', res);
  }
});

router.get('/messages', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: adminMessages.id,
      senderAdminId: adminMessages.senderAdminId,
      targetType: adminMessages.targetType,
      targetPharmacyId: adminMessages.targetPharmacyId,
      title: adminMessages.title,
      body: adminMessages.body,
      actionPath: adminMessages.actionPath,
      createdAt: adminMessages.createdAt,
    })
      .from(adminMessages)
      .orderBy(desc(adminMessages.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(adminMessages);

    const mappedRows = rows.map((row) => ({
      ...row,
      actionPath: sanitizeInternalPath(row.actionPath) ?? null,
    }));
    sendPaginated(res, mappedRows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin messages list error', '管理者メッセージ一覧の取得に失敗しました', res);
  }
});

router.post('/messages', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const targetType = req.body.targetType as 'all' | 'pharmacy';
    const targetPharmacyIdRaw = req.body.targetPharmacyId;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const actionPath = typeof req.body.actionPath === 'string' ? req.body.actionPath.trim() : '';

    if (!targetType || !['all', 'pharmacy'].includes(targetType)) {
      res.status(400).json({ error: '送信対象が不正です' });
      return;
    }

    if (!title || title.length > 100) {
      res.status(400).json({ error: 'タイトルは1〜100文字で入力してください' });
      return;
    }

    if (!body || body.length > 2000) {
      res.status(400).json({ error: '本文は1〜2000文字で入力してください' });
      return;
    }

    let targetPharmacyId: number | null = null;
    if (targetType === 'pharmacy') {
      targetPharmacyId = parsePositiveInt(String(targetPharmacyIdRaw ?? ''));
      if (!targetPharmacyId) {
        res.status(400).json({ error: '送信先薬局IDが不正です' });
        return;
      }

      const targetRows = await db.select({ id: pharmacies.id })
        .from(pharmacies)
        .where(and(
          eq(pharmacies.id, targetPharmacyId),
          eq(pharmacies.isActive, true),
        ))
        .limit(1);

      if (targetRows.length === 0) {
        res.status(404).json({ error: '送信先薬局が見つかりません' });
        return;
      }
    }

    if (actionPath && !isSafeInternalPath(actionPath)) {
      res.status(400).json({ error: '遷移先パスが不正です' });
      return;
    }

    await db.insert(adminMessages).values({
      senderAdminId: req.user!.id,
      targetType,
      targetPharmacyId,
      title,
      body,
      actionPath: actionPath || null,
    });

    writeLog('admin_send_message', {
      pharmacyId: req.user!.id,
      detail: `メッセージ送信: ${title} (対象: ${targetType === 'all' ? '全体' : `薬局ID:${targetPharmacyId}`})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ message: '加盟薬局へメッセージを送信しました' });
  } catch (err) {
    handleAdminError(err, 'Admin message send error', 'メッセージ送信に失敗しました', res);
  }
});

router.get('/requests', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      pharmacyName: pharmacies.name,
      requestText: userRequests.requestText,
      openclawStatus: userRequests.openclawStatus,
      openclawThreadId: userRequests.openclawThreadId,
      openclawSummary: userRequests.openclawSummary,
      createdAt: userRequests.createdAt,
      updatedAt: userRequests.updatedAt,
    })
      .from(userRequests)
      .innerJoin(pharmacies, eq(userRequests.pharmacyId, pharmacies.id))
      .orderBy(desc(userRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(userRequests);
    sendPaginated(res, rows, page, limit, total.count, {
      connector: {
        configured: isOpenClawConnectorConfigured(),
        webhookConfigured: isOpenClawWebhookConfigured(),
        implementationBranch: getOpenClawImplementationBranch(),
      },
    });
  } catch (err) {
    handleAdminError(err, 'Admin user requests list error', '要望一覧の取得に失敗しました', res);
  }
});

router.post('/requests/:id/handoff', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parseIdOrBadRequest(res, req.params.id);
    if (!requestId) return;

    const [requestRow] = await db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      requestText: userRequests.requestText,
      openclawStatus: userRequests.openclawStatus,
    })
      .from(userRequests)
      .where(eq(userRequests.id, requestId))
      .limit(1);

    if (!requestRow) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    if (requestRow.openclawStatus === 'completed') {
      res.status(400).json({ error: '完了済み要望は再連携できません' });
      return;
    }

    const handoff = await handoffToOpenClaw({
      requestId: requestRow.id,
      pharmacyId: requestRow.pharmacyId,
      requestText: requestRow.requestText,
      context: await collectAdminHandoffContext(requestRow.pharmacyId, requestRow.id),
    });

    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, requestRow.id));
    }

    sendAdminHandoffResponse(res, handoff);
  } catch (err) {
    handleAdminError(err, 'Admin user request handoff error', '再連携に失敗しました', res);
  }
});

export default router;
