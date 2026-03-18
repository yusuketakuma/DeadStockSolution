import { Router, Response } from 'express';
import { and, desc, inArray, eq } from 'drizzle-orm';
import { buildTokenizedSearchConditions } from '../utils/search-utils';
import { normalizeSearchTerm } from '../utils/request-utils';
import { db } from '../config/database';
import {
  pharmacies,
  exchangeProposals,
  adminMessages,
  userRequests,
} from '../db/schema';
import { AuthRequest } from '../types';
import { sanitizeInternalPath } from '../utils/path-utils';
import { rowCount } from '../utils/db-utils';
import {
  getOpenClawImplementationBranch,
  isOpenClawConnectorConfigured,
  isOpenClawWebhookConfigured,
} from '../services/openclaw-service';
import { sendPaginated, parseListPagination, handleAdminError } from './admin-utils';

const router = Router();

function buildConnectorMetadata() {
  return {
    configured: isOpenClawConnectorConfigured(),
    webhookConfigured: isOpenClawWebhookConfigured(),
    implementationBranch: getOpenClawImplementationBranch(),
  };
}

function mapExchangeHistoryRows(
  rows: Array<{
    id: number;
    proposalId: number | null;
    pharmacyAId: number;
    pharmacyBId: number;
    totalValue: string | null;
    completedAt: string | null;
  }>,
  pharmacyMap: Map<number, string>,
) {
  return rows.map((row) => ({
    ...row,
    pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
    pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
  }));
}

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
    const search = normalizeSearchTerm(req.query.search);

    const searchCondition = search
      ? buildTokenizedSearchConditions(search, [pharmacies.name, pharmacies.email])
      : undefined;

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
      .where(searchCondition)
      .orderBy(desc(pharmacies.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(pharmacies).where(searchCondition);

    sendPaginated(res, rows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin pharmacies error', '薬局一覧の取得に失敗しました', res);
  }
});

router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: exchangeProposals.id,
      proposalId: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      totalValue: exchangeProposals.completedTotalValue,
      completedAt: exchangeProposals.completedAt,
    })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.status, 'completed'))
      .orderBy(desc(exchangeProposals.completedAt))
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
    const [total] = await db.select({ count: rowCount }).from(exchangeProposals).where(eq(exchangeProposals.status, 'completed'));

    sendPaginated(res, mapExchangeHistoryRows(rows, pharmacyMap), page, limit, total.count);
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
      .orderBy(desc(userRequests.createdAt), desc(userRequests.id))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(userRequests);
    sendPaginated(res, rows, page, limit, total.count, {
      connector: buildConnectorMetadata(),
    });
  } catch (err) {
    handleAdminError(err, 'Admin user requests list error', '要望一覧の取得に失敗しました', res);
  }
});

export default router;
