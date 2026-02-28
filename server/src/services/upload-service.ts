import readXlsxFile from 'read-excel-file/node';
import crypto from 'crypto';

const MAX_UPLOAD_ROWS = 100000;
const MAX_UPLOAD_COLUMNS = 200;
const MAX_UPLOAD_CELLS = 3_000_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 6;
const MAX_CACHE_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_CACHEABLE_BUFFER_BYTES = 5 * 1024 * 1024;

interface ParsedExcelCacheEntry {
  rows: unknown[][];
  createdAt: number;
  sizeBytes: number;
}

const parsedExcelCache = new Map<string, ParsedExcelCacheEntry>();

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
  if (parsedExcelCache.size <= MAX_CACHE_ENTRIES) {
    const totalSize = [...parsedExcelCache.values()].reduce((sum, entry) => sum + entry.sizeBytes, 0);
    if (totalSize <= MAX_CACHE_TOTAL_BYTES) {
      return;
    }
  }

  const entries = [...parsedExcelCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  let currentTotal = entries.reduce((sum, [, entry]) => sum + entry.sizeBytes, 0);

  for (const [key, entry] of entries) {
    const shouldTrimByEntries = parsedExcelCache.size > MAX_CACHE_ENTRIES;
    const shouldTrimByTotalSize = currentTotal > MAX_CACHE_TOTAL_BYTES;
    if (!shouldTrimByEntries && !shouldTrimByTotalSize) {
      break;
    }
    parsedExcelCache.delete(key);
    currentTotal -= entry.sizeBytes;
  }
}

function cacheParsedRows(cacheKey: string, rows: unknown[][], sizeBytes: number): void {
  parsedExcelCache.set(cacheKey, {
    rows,
    createdAt: Date.now(),
    sizeBytes,
  });
  enforceCacheLimit();
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function parseExcelBuffer(buffer: Buffer): Promise<unknown[][]> {
  pruneExpiredCache();
  const isCacheableBuffer = buffer.length <= MAX_CACHEABLE_BUFFER_BYTES;
  const cacheKey = isCacheableBuffer ? buildCacheKey(buffer) : null;
  if (isCacheableBuffer) {
    const cached = parsedExcelCache.get(cacheKey!);
    if (cached) {
      return cached.rows;
    }
  }

  const rows = await readXlsxFile(buffer);

  if (rows.length > MAX_UPLOAD_ROWS) {
    throw new Error(`行数が上限(${MAX_UPLOAD_ROWS})を超えています`);
  }

  let totalCells = 0;
  const normalized = rows.map((row) => {
    if (row.length > MAX_UPLOAD_COLUMNS) {
      throw new Error(`列数が上限(${MAX_UPLOAD_COLUMNS})を超えています`);
    }
    totalCells += row.length;
    if (totalCells > MAX_UPLOAD_CELLS) {
      throw new Error(`セル数が上限(${MAX_UPLOAD_CELLS})を超えています`);
    }
    return row.map((cell) => normalizeCellValue(cell));
  });

  if (isCacheableBuffer) {
    cacheParsedRows(cacheKey!, normalized, buffer.length);
  }

  return normalized;
}

export function getPreviewRows(allRows: unknown[][], headerRowIndex: number, count: number = 5): unknown[][] {
  const start = headerRowIndex + 1;
  return allRows.slice(start, start + count);
}
