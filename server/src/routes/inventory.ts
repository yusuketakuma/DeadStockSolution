import { Router, Response } from 'express';
import { eq, and, or, like, desc, inArray, notExists } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  usedMedicationItems,
  pharmacies,
  pharmacyBusinessHours,
  pharmacySpecialHours,
  pharmacyRelationships,
} from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { groupBy } from '../utils/array-utils';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, escapeLikeWildcards, buildPaginatedResponse } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import { logger } from '../services/logger';
import { writeLog, getClientIp } from '../services/log-service';
import { getPharmacyRiskDetail, invalidateAdminRiskSnapshotCache } from '../services/expiry-risk-service';
import { parseCameraCode, type CameraCodeType } from '../services/gs1-parser';
import {
  confirmCameraDeadStockBatch,
  resolveCameraMatchByCode,
  sanitizeRawCode,
  searchCameraManualCandidates,
} from '../services/camera-dead-stock-service';
import {
  cameraResolveSchema,
  cameraConfirmSchema,
  cameraManualCandidatesSchema,
  type CameraResolveBody,
  type CameraConfirmBody,
  type CameraManualCandidatesQuery,
} from '../utils/validators';
import { ApiError, isApiError } from '../utils/api-error';

const CAMERA_BAD_REQUEST_MESSAGES = new Set<string>([
  '読取コードを入力してください',
  '検索キーワードを入力してください',
  '登録する行がありません',
  '一度に登録できる件数は200件までです',
  '検索キーワードは2文字以上で入力してください',
  '検索キーワードは80文字以内で入力してください',
]);

function isCameraBadRequestMessage(message: string): boolean {
  return message.startsWith('行') || CAMERA_BAD_REQUEST_MESSAGES.has(message);
}

// Helper to handle errors consistently
function handleRouteError(err: unknown, logContext: string, res: Response): void {
  if (isApiError(err)) {
    res.status(err.status).json(err.toBody());
    return;
  }
  const message = err instanceof Error ? err.message : '不明なエラー';
  if (message === '薬局が見つかりません') {
    res.status(404).json({ error: message });
    return;
  }
  if (isCameraBadRequestMessage(message)) {
    res.status(400).json({ error: message });
    return;
  }
  logger.error(logContext, { error: message });
  res.status(500).json({ error: 'サーバーエラーが発生しました' });
}

const router = Router();

router.use(requireLogin);

// My dead stock expiry risk summary
router.get('/dead-stock/risk', async (req: AuthRequest, res: Response) => {
  try {
    const detail = await getPharmacyRiskDetail(req.user!.id);
    res.json(detail);
  } catch (err) {
    handleRouteError(err, 'Dead stock risk summary error', res);
  }
});

// Resolve GS1/YJ code from camera/manual scan (no persistence)
router.post('/dead-stock/camera/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const parseResult = cameraResolveSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? '読取コードを入力してください' });
      return;
    }
    const { rawCode: rawCodeInput } = parseResult.data;
    const rawCode = sanitizeRawCode(rawCodeInput);
    if (!rawCode) {
      res.status(400).json({ error: '読取コードを入力してください' });
      return;
    }

    const parsed = parseCameraCode(rawCode);
    const match = await resolveCameraMatchByCode(parsed);

    const response = {
      codeType: parsed.codeType as CameraCodeType,
      parsed: {
        gtin: parsed.gtin,
        yjCode: parsed.yjCode,
        expirationDate: parsed.expirationDate,
        lotNumber: parsed.lotNumber,
      },
      match,
      warnings: parsed.warnings,
    };

    res.json(response);
  } catch (err) {
    handleRouteError(err, 'Camera resolve error', res);
  }
});

// Search drug master candidates for unmatched camera rows
router.get('/dead-stock/camera/manual-candidates', async (req: AuthRequest, res: Response) => {
  try {
    const parseResult = cameraManualCandidatesSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? '検索キーワードを入力してください' });
      return;
    }
    const { q, limit } = parseResult.data;
    const search = normalizeSearchTerm(q);
    if (!search) {
      res.status(400).json({ error: '検索キーワードを入力してください' });
      return;
    }

    const data = await searchCameraManualCandidates(search, limit);
    res.json({ data });
  } catch (err) {
    handleRouteError(err, 'Camera manual candidates error', res);
  }
});

// Confirm scanned rows and register as dead stock
router.post('/dead-stock/camera/confirm-batch', async (req: AuthRequest, res: Response) => {
  try {
    const parseResult = cameraConfirmSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? '登録する行がありません' });
      return;
    }
    const { items } = parseResult.data;
    const result = await confirmCameraDeadStockBatch(req.user!.id, items);

    invalidateAdminRiskSnapshotCache();
    void writeLog('upload', {
      pharmacyId: req.user!.id,
      detail: `カメラ登録 ${result.createdCount}件 (uploadId:${result.uploadId})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      message: `${result.createdCount}件のデータを登録しました`,
      uploadId: result.uploadId,
      createdCount: result.createdCount,
    });
  } catch (err) {
    handleRouteError(err, 'Camera confirm batch error', res);
  }
});

// My dead stock list
router.get('/dead-stock', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const items = await db.select()
      .from(deadStockItems)
      .where(eq(deadStockItems.pharmacyId, req.user!.id))
      .orderBy(desc(deadStockItems.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount })
      .from(deadStockItems)
      .where(eq(deadStockItems.pharmacyId, req.user!.id));

    res.json(buildPaginatedResponse(items, { page, limit, total: total.count }));
  } catch (err) {
    logger.error('Dead stock list error:', { error: (err as Error).message });
    res.status(500).json({ error: 'デッドストックリストの取得に失敗しました' });
  }
});

// Delete dead stock item
router.delete('/dead-stock/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const deleted = await db.delete(deadStockItems)
      .where(and(
        eq(deadStockItems.id, id),
        eq(deadStockItems.pharmacyId, req.user!.id),
      ))
      .returning({ id: deadStockItems.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: '対象データが見つかりません' });
      return;
    }

    void writeLog('dead_stock_delete', {
      pharmacyId: req.user!.id,
      detail: `在庫ID:${id} を削除`,
      ipAddress: getClientIp(req),
    });

    res.json({ message: '削除しました' });
  } catch (err) {
    logger.error('Delete dead stock error:', { error: (err as Error).message });
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// My used medication list
router.get('/used-medication', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const items = await db.select()
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, req.user!.id))
      .orderBy(desc(usedMedicationItems.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount })
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, req.user!.id));

    res.json(buildPaginatedResponse(items, { page, limit, total: total.count }));
  } catch (err) {
    logger.error('Used medication list error:', { error: (err as Error).message });
    res.status(500).json({ error: '医薬品使用量リストの取得に失敗しました' });
  }
});

// Browse all pharmacies' inventory
router.get('/browse', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const search = normalizeSearchTerm(req.query.search);

    let searchCondition;
    if (search) {
      const normalized = normalizeKana(search);
      const hiragana = katakanaToHiragana(normalized);
      const katakana = hiraganaToKatakana(normalized);
      const likeTerms = [...new Set([normalized, hiragana, katakana])];
      const likeConditions = likeTerms.map((term) => like(deadStockItems.drugName, `%${escapeLikeWildcards(term)}%`));
      searchCondition = likeConditions.length === 1 ? likeConditions[0] : or(...likeConditions);
    }

    const blockCondition = notExists(
      db.select({ id: pharmacyRelationships.id })
        .from(pharmacyRelationships)
        .where(and(
          eq(pharmacyRelationships.relationshipType, 'blocked'),
          or(
            and(
              eq(pharmacyRelationships.pharmacyId, req.user!.id),
              eq(pharmacyRelationships.targetPharmacyId, deadStockItems.pharmacyId),
            ),
            and(
              eq(pharmacyRelationships.pharmacyId, deadStockItems.pharmacyId),
              eq(pharmacyRelationships.targetPharmacyId, req.user!.id),
            ),
          ),
        ))
    );

    const whereExpr = and(
      eq(deadStockItems.isAvailable, true),
      eq(pharmacies.isActive, true),
      searchCondition,
      blockCondition,
    );

    const items = await db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      packageLabel: deadStockItems.packageLabel,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      yakkaTotal: deadStockItems.yakkaTotal,
      expirationDate: deadStockItems.expirationDate,
      pharmacyName: pharmacies.name,
      prefecture: pharmacies.prefecture,
    })
      .from(deadStockItems)
      .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
      .where(whereExpr)
      .orderBy(desc(deadStockItems.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch business hours for pharmacies in results
    const pharmacyIds = [...new Set(items.map((i) => i.pharmacyId))];
    const [allHours, allSpecialHours] = pharmacyIds.length > 0
      ? await Promise.all([
        db.select({
          pharmacyId: pharmacyBusinessHours.pharmacyId,
          dayOfWeek: pharmacyBusinessHours.dayOfWeek,
          openTime: pharmacyBusinessHours.openTime,
          closeTime: pharmacyBusinessHours.closeTime,
          isClosed: pharmacyBusinessHours.isClosed,
          is24Hours: pharmacyBusinessHours.is24Hours,
        })
          .from(pharmacyBusinessHours)
          .where(inArray(pharmacyBusinessHours.pharmacyId, pharmacyIds)),
        db.select({
          pharmacyId: pharmacySpecialHours.pharmacyId,
          id: pharmacySpecialHours.id,
          specialType: pharmacySpecialHours.specialType,
          startDate: pharmacySpecialHours.startDate,
          endDate: pharmacySpecialHours.endDate,
          openTime: pharmacySpecialHours.openTime,
          closeTime: pharmacySpecialHours.closeTime,
          isClosed: pharmacySpecialHours.isClosed,
          is24Hours: pharmacySpecialHours.is24Hours,
          note: pharmacySpecialHours.note,
          updatedAt: pharmacySpecialHours.updatedAt,
        })
          .from(pharmacySpecialHours)
          .where(inArray(pharmacySpecialHours.pharmacyId, pharmacyIds)),
      ])
      : [[], []];

    const hoursByPharmacy = groupBy(allHours, (h) => h.pharmacyId);
    const specialHoursByPharmacy = groupBy(allSpecialHours, (h) => h.pharmacyId);

    const now = new Date();
    const enrichedItems = items.map(({ pharmacyId, ...item }) => {
      const hours = hoursByPharmacy.get(pharmacyId) ?? [];
      const specialHours = specialHoursByPharmacy.get(pharmacyId) ?? [];
      const status = getBusinessHoursStatus(hours, specialHours, now);
      const isConfigured = hours.length > 0 || specialHours.length > 0;
      return { ...item, businessStatus: { ...status, isConfigured } };
    });

    const [total] = await db.select({ count: rowCount })
      .from(deadStockItems)
      .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
      .where(whereExpr);

    res.json(buildPaginatedResponse(enrichedItems, { page, limit, total: total.count }));
  } catch (err) {
    logger.error('Browse inventory error:', { error: (err as Error).message });
    res.status(500).json({ error: '在庫参照に失敗しました' });
  }
});

export default router;
