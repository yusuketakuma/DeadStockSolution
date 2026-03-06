export interface PaginationOptions {
  defaultPage?: number;
  defaultLimit?: number;
  maxLimit?: number;
  maxPage?: number;
}

export interface ParsedPagination {
  page: number;
  limit: number;
  offset: number;
}

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parsePagination(
  pageValue: unknown,
  limitValue: unknown,
  options: PaginationOptions = {}
): ParsedPagination {
  const defaultPage = options.defaultPage ?? 1;
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;
  const maxPage = options.maxPage ?? 10000;

  const parsedPage = parsePositiveInt(pageValue);
  const parsedLimit = parsePositiveInt(limitValue);

  const page = Math.min(parsedPage ?? defaultPage, maxPage);
  const limit = Math.min(parsedLimit ?? defaultLimit, maxLimit);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

export function normalizeSearchTerm(value: unknown, maxLength: number = 100): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
  if (!sanitized) return undefined;
  return sanitized.slice(0, maxLength);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Escape LIKE wildcards for safe use in SQL LIKE patterns */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export function buildPaginatedResponse<T>(data: T[], pagination: { page: number; limit: number; total: number }) {
  return {
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  };
}
