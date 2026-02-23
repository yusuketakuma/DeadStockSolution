import readXlsxFile from 'read-excel-file/node';
import crypto from 'crypto';

const MAX_UPLOAD_ROWS = 10000;
const MAX_UPLOAD_COLUMNS = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 30;
const parsedExcelCache = new Map<string, { rows: unknown[][]; createdAt: number }>();

function buildCacheKey(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function pruneExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of parsedExcelCache.entries()) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      parsedExcelCache.delete(key);
    }
  }
}

function enforceCacheLimit(): void {
  if (parsedExcelCache.size <= MAX_CACHE_ENTRIES) return;

  const entries = [...parsedExcelCache.entries()]
    .sort((a, b) => a[1].createdAt - b[1].createdAt);

  const overflow = parsedExcelCache.size - MAX_CACHE_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    parsedExcelCache.delete(entries[i][0]);
  }
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function parseExcelBuffer(buffer: Buffer): Promise<unknown[][]> {
  pruneExpiredCache();
  const cacheKey = buildCacheKey(buffer);
  const cached = parsedExcelCache.get(cacheKey);
  if (cached) {
    return cached.rows;
  }

  const rows = await readXlsxFile(buffer);

  if (rows.length > MAX_UPLOAD_ROWS) {
    throw new Error(`行数が上限(${MAX_UPLOAD_ROWS})を超えています`);
  }

  const normalized = rows.map((row) => {
    if (row.length > MAX_UPLOAD_COLUMNS) {
      throw new Error(`列数が上限(${MAX_UPLOAD_COLUMNS})を超えています`);
    }
    return row.map((cell) => normalizeCellValue(cell));
  });

  parsedExcelCache.set(cacheKey, { rows: normalized, createdAt: Date.now() });
  enforceCacheLimit();

  return normalized;
}

export function getPreviewRows(allRows: unknown[][], headerRowIndex: number, count: number = 5): unknown[][] {
  const start = headerRowIndex + 1;
  return allRows.slice(start, start + count);
}
