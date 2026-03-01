import { Router, Response } from 'express';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeHistory,
  pharmacies,
} from '../db/schema';
import { AuthRequest } from '../types';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';
import { decodeCursor, encodeCursor } from '../utils/cursor-pagination';

const router = Router();

interface HistoryCursor {
  completedAt: string | null;
  id: number;
}

function parseHistoryCursor(raw: unknown): HistoryCursor | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const cursor = decodeCursor<HistoryCursor>(raw);
  if (!cursor) return null;
  if (!Number.isInteger(cursor.id) || cursor.id <= 0) return null;
  if (cursor.completedAt !== null && typeof cursor.completedAt !== 'string') return null;
  return cursor;
}

// Exchange history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
      maxPage: 200,
    });
    const cursorLimit = parsePositiveInt(req.query.limit);
    const cursor = parseHistoryCursor(req.query.cursor);
    if (cursor === null) {
      res.status(400).json({ error: 'cursorが不正です' });
      return;
    }
    const resolvedLimit = Math.min(cursorLimit ?? limit, 100);
    const pharmacyId = req.user!.id;
    const ownershipFilter = or(
      eq(exchangeHistory.pharmacyAId, pharmacyId),
      eq(exchangeHistory.pharmacyBId, pharmacyId),
    );
    const cursorFilter = cursor
      ? (cursor.completedAt === null
          ? lt(exchangeHistory.id, cursor.id)
          : or(
              lt(exchangeHistory.completedAt, cursor.completedAt),
              and(
                eq(exchangeHistory.completedAt, cursor.completedAt),
                lt(exchangeHistory.id, cursor.id),
              ),
            ))
      : undefined;
    const whereClause = cursorFilter ? and(ownershipFilter, cursorFilter) : ownershipFilter;

    const historyQuery = db.select()
        .from(exchangeHistory)
        .where(whereClause)
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(cursor ? resolvedLimit + 1 : resolvedLimit)
        .offset(cursor ? 0 : offset);

    const [rows, countRows] = await Promise.all([
      historyQuery,
      cursor
        ? Promise.resolve([{ count: 0 }])
        : db.select({ count: rowCount })
          .from(exchangeHistory)
          .where(ownershipFilter),
    ]);
    const [countRow] = countRows;

    const hasMore = cursor ? rows.length > resolvedLimit : page * resolvedLimit < countRow.count;
    const pageRows = cursor ? rows.slice(0, resolvedLimit) : rows;
    const pharmacyIds = [...new Set(pageRows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];
    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

    const enriched = pageRows.map((row) => ({
      ...row,
      pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
      pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
    }));

    const totalCount = cursor ? undefined : countRow.count;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow
      ? encodeCursor<HistoryCursor>({ completedAt: lastRow.completedAt ?? null, id: lastRow.id })
      : null;
    const mode = cursor ? 'cursor' : 'page';

    res.json({
      data: enriched,
      pagination: {
        page,
        limit: resolvedLimit,
        total: totalCount,
        totalPages: totalCount !== undefined ? Math.ceil(totalCount / resolvedLimit) : undefined,
        mode,
        hasMore,
        nextCursor,
      },
    });
  } catch (err) {
    logger.error('Exchange history error:', { error: (err as Error).message });
    res.status(500).json({ error: '交換履歴の取得に失敗しました' });
  }
});

export default router;
