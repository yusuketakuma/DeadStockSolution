import { Router, Response } from 'express';
import { eq, and, or, desc, inArray, notExists, asc, sql } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { db } from '../config/database';
import {
  deadStockItems,
  drugMasterPackages,
  usedMedicationItems,
  pharmacies,
  pharmacyRelationships,
} from '../db/schema';
import { buildBusinessStatusMap } from '../utils/business-hours-utils';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePagination, buildPaginatedResponse } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { buildTokenizedSearchConditions, buildSearchRelevanceScore } from '../utils/search-utils';
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
  inventorySearchSchema,
} from '../utils/validators';
import { searchInventoryAvailability } from '../services/inventory-search-service';
import { isApiError } from '../utils/api-error';
import { sendBadRequest } from './response-helpers';

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

function parsePayloadOrRespond<TSchema extends ZodType>(
  schema: TSchema,
  payload: unknown,
  res: Response,
  fallbackMessage: string,
): TSchema['_output'] | null {
  const parseResult = schema.safeParse(payload);
  if (!parseResult.success) {
    return sendBadRequest(res, parseResult.error.issues[0]?.message ?? fallbackMessage);
  }
  return parseResult.data;
}

function buildCameraResolveResponse(
  parsed: ReturnType<typeof parseCameraCode>,
  match: Awaited<ReturnType<typeof resolveCameraMatchByCode>>,
) {
  return {
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
}

function buildBrowseSearchCondition(rawSearch: unknown) {
  const search = normalizeSearchTerm(rawSearch);
  if (!search) {
    return undefined;
  }
  return buildTokenizedSearchConditions(search, [deadStockItems.drugName]);
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
    sendBadRequest(res, message);
    return;
  }
  logger.error(logContext, { error: message });
  res.status(500).json({ error: 'サーバーエラーが発生しました' });
}

const router = Router();

router.use(requireLogin);

const DEAD_STOCK_PACKAGE_SELECT_FIELDS = {
  packageQuantity: sql<number | null>`(
    select ${drugMasterPackages.packageQuantity}
    from ${drugMasterPackages}
    where ${drugMasterPackages.id} = ${deadStockItems.drugMasterPackageId}
    limit 1
  )`,
  packageUnit: sql<string | null>`(
    select ${drugMasterPackages.packageUnit}
    from ${drugMasterPackages}
    where ${drugMasterPackages.id} = ${deadStockItems.drugMasterPackageId}
    limit 1
  )`,
  packageForm: sql<string | null>`(
    select ${drugMasterPackages.packageForm}
    from ${drugMasterPackages}
    where ${drugMasterPackages.id} = ${deadStockItems.drugMasterPackageId}
    limit 1
  )`,
  isLoosePackage: sql<boolean | null>`(
    select ${drugMasterPackages.isLoosePackage}
    from ${drugMasterPackages}
    where ${drugMasterPackages.id} = ${deadStockItems.drugMasterPackageId}
    limit 1
  )`,
} as const;

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
    const data = parsePayloadOrRespond(cameraResolveSchema, req.body ?? {}, res, '読取コードを入力してください');
    if (!data) {
      return;
    }
    const { rawCode: rawCodeInput } = data;
    const rawCode = sanitizeRawCode(rawCodeInput);
    if (!rawCode) {
      sendBadRequest(res, '読取コードを入力してください');
      return;
    }

    const parsed = parseCameraCode(rawCode);
    const match = await resolveCameraMatchByCode(parsed);
    res.json(buildCameraResolveResponse(parsed, match));
  } catch (err) {
    handleRouteError(err, 'Camera resolve error', res);
  }
});

// Search drug master candidates for unmatched camera rows
router.get('/dead-stock/camera/manual-candidates', async (req: AuthRequest, res: Response) => {
  try {
    const data = parsePayloadOrRespond(cameraManualCandidatesSchema, req.query, res, '検索キーワードを入力してください');
    if (!data) {
      return;
    }
    const { q, limit } = data;
    const search = normalizeSearchTerm(q);
    if (!search) {
      sendBadRequest(res, '検索キーワードを入力してください');
      return;
    }

    const candidates = await searchCameraManualCandidates(search, limit);
    res.json({ data: candidates });
  } catch (err) {
    handleRouteError(err, 'Camera manual candidates error', res);
  }
});

// Confirm scanned rows and register as dead stock
router.post('/dead-stock/camera/confirm-batch', async (req: AuthRequest, res: Response) => {
  try {
    const data = parsePayloadOrRespond(cameraConfirmSchema, req.body ?? {}, res, '登録する行がありません');
    if (!data) {
      return;
    }
    const { items } = data;
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

    const search = normalizeSearchTerm(req.query.search);
    const searchCondition = search
      ? buildTokenizedSearchConditions(search, [deadStockItems.drugName])
      : undefined;
    const relevanceScore = search
      ? buildSearchRelevanceScore(search, [{ column: deadStockItems.drugName, weight: 5 }])
      : null;

    const whereExpr = and(
      eq(deadStockItems.pharmacyId, req.user!.id),
      searchCondition,
    );

    const items = await db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      uploadId: deadStockItems.uploadId,
      drugCode: deadStockItems.drugCode,
      drugName: deadStockItems.drugName,
      drugMasterId: deadStockItems.drugMasterId,
      drugMasterPackageId: deadStockItems.drugMasterPackageId,
      packageLabel: deadStockItems.packageLabel,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      yakkaTotal: deadStockItems.yakkaTotal,
      expirationDate: deadStockItems.expirationDate,
      expirationDateIso: deadStockItems.expirationDateIso,
      lotNumber: deadStockItems.lotNumber,
      isAvailable: deadStockItems.isAvailable,
      createdAt: deadStockItems.createdAt,
      ...DEAD_STOCK_PACKAGE_SELECT_FIELDS,
    })
      .from(deadStockItems)
      .where(whereExpr)
      .orderBy(
        ...(relevanceScore ? [desc(relevanceScore)] : []),
        desc(deadStockItems.createdAt),
      )
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount })
      .from(deadStockItems)
      .where(whereExpr);

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
      sendBadRequest(res, '不正なIDです');
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
    const searchCondition = buildBrowseSearchCondition(req.query.search);
    const search = normalizeSearchTerm(req.query.search);
    const relevanceScore = search
      ? buildSearchRelevanceScore(search, [{ column: deadStockItems.drugName, weight: 5 }])
      : null;

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
      drugMasterPackageId: deadStockItems.drugMasterPackageId,
      ...DEAD_STOCK_PACKAGE_SELECT_FIELDS,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      yakkaTotal: deadStockItems.yakkaTotal,
      expirationDate: deadStockItems.expirationDate,
      pharmacyName: pharmacies.name,
      prefecture: pharmacies.prefecture,
    })
      .from(deadStockItems)
      .innerJoin(pharmacies, eq(deadStockItems.pharmacyId, pharmacies.id))
      .where(whereExpr)
      .orderBy(
        ...(relevanceScore ? [desc(relevanceScore)] : []),
        desc(deadStockItems.createdAt),
        asc(pharmacies.name),
      )
      .limit(limit)
      .offset(offset);

    const pharmacyIds = [...new Set(items.map((i) => i.pharmacyId))];
    const now = new Date();
    const businessStatusMap = await buildBusinessStatusMap(pharmacyIds, now);
    const enrichedItems = items.map(({ pharmacyId, ...item }) => {
      return { ...item, businessStatus: businessStatusMap.get(pharmacyId)! };
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

async function handleInventorySearch(req: AuthRequest, res: Response) {
  try {
    const data = parsePayloadOrRespond(inventorySearchSchema, req.body ?? {}, res, '在庫検索条件を入力してください');
    if (!data) return;

    const result = await searchInventoryAvailability(
      req.user!.id,
      data.drugKeys,
      data.filters,
      data.coordinates,
    );

    res.json(result);
  } catch (err) {
    handleRouteError(err, 'Inventory search error', res);
  }
}

// Inventory search across pharmacies
router.post('/inventory-search', handleInventorySearch);

export default router;
