import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => 'count_fn'),
  eq: vi.fn(() => ({})),
  ilike: vi.fn(() => ({})),
}));

vi.mock('../db/schema', () => ({
  errorCodes: {
    code: 'code',
    category: 'category',
    severity: 'severity',
    isActive: 'isActive',
    id: 'id',
  },
  errorCodeCategoryValues: ['upload', 'auth', 'sync', 'system', 'openclaw'],
  errorCodeSeverityValues: ['critical', 'error', 'warning', 'info'],
}));

vi.mock('../utils/request-utils', () => ({
  escapeLikeWildcards: vi.fn((v: string) => v),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  listErrorCodes,
  getErrorCodeByCode,
  createErrorCode,
  updateErrorCode,
  seedInitialErrorCodes,
} from '../services/error-code-service';

// ── Helper: create chained select mock ──────────────
function createSelectChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    then: undefined as unknown,
  } as {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    offset: ReturnType<typeof vi.fn>;
    then: Promise<unknown>['then'];
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  chain.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

// ── Helper: create chained insert mock ──────────────
function createInsertChain(result: unknown) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn(),
    onConflictDoNothing: vi.fn(),
    then: undefined as unknown,
  } as {
    values: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
    onConflictDoNothing: ReturnType<typeof vi.fn>;
    then: Promise<unknown>['then'];
  };
  chain.values.mockReturnValue(chain);
  chain.returning.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  chain.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

// ── Helper: create chained update mock ──────────────
function createUpdateChain(result: unknown) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
    then: undefined as unknown,
  } as {
    set: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
    then: Promise<unknown>['then'];
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockReturnValue(chain);
  chain.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

describe('error-code-service (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────
  // listErrorCodes
  // ────────────────────────────────────────────────────
  describe('listErrorCodes', () => {
    it('should return items and total with default options', async () => {
      const items = [{ id: 1, code: 'TEST', category: 'system' }];
      const itemsChain = createSelectChain(items);
      const countChain = createSelectChain([{ value: 1 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes();

      expect(result.items).toEqual(items);
      expect(result.total).toBe(1);
    });

    it('should apply category filter', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([{ value: 0 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes({ category: 'upload' });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should apply severity filter', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([{ value: 0 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes({ severity: 'error' });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should apply activeOnly filter', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([{ value: 0 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes({ activeOnly: true });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should apply search filter', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([{ value: 0 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes({ search: 'UPLOAD' });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should apply limit and offset', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([{ value: 0 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes({ limit: 10, offset: 20 });

      expect(result.items).toEqual([]);
      expect(itemsChain.limit).toHaveBeenCalledWith(10);
      expect(itemsChain.offset).toHaveBeenCalledWith(20);
    });

    it('should handle totalRow being undefined', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([undefined]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes();

      expect(result.total).toBe(0);
    });

    it('should return empty on DB error', async () => {
      mocks.select.mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const result = await listErrorCodes();

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(mocks.loggerError).toHaveBeenCalled();
    });

    it('should apply all filters together', async () => {
      const itemsChain = createSelectChain([]);
      const countChain = createSelectChain([{ value: 0 }]);
      mocks.select
        .mockReturnValueOnce(itemsChain)
        .mockReturnValueOnce(countChain);

      const result = await listErrorCodes({
        category: 'system',
        severity: 'critical',
        activeOnly: true,
        search: 'INTERNAL',
        limit: 5,
        offset: 0,
      });

      expect(result.items).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────
  // getErrorCodeByCode
  // ────────────────────────────────────────────────────
  describe('getErrorCodeByCode', () => {
    it('should return error code row when found', async () => {
      const row = { id: 1, code: 'UPLOAD_PARSE_FAILED', category: 'upload' };
      const chain = createSelectChain([row]);
      mocks.select.mockReturnValue(chain);

      const result = await getErrorCodeByCode('UPLOAD_PARSE_FAILED');

      expect(result).toEqual(row);
    });

    it('should return null when not found', async () => {
      const chain = createSelectChain([]);
      mocks.select.mockReturnValue(chain);

      const result = await getErrorCodeByCode('NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should return null on DB error', async () => {
      mocks.select.mockImplementation(() => {
        throw new Error('DB timeout');
      });

      const result = await getErrorCodeByCode('TEST');

      expect(result).toBeNull();
      expect(mocks.loggerError).toHaveBeenCalled();
    });

    it('should log non-Error thrown values', async () => {
      mocks.select.mockImplementation(() => {
        throw 'string error';
      });

      const result = await getErrorCodeByCode('TEST');

      expect(result).toBeNull();
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Failed to get error code',
        expect.objectContaining({ error: 'string error' }),
      );
    });
  });

  // ────────────────────────────────────────────────────
  // createErrorCode
  // ────────────────────────────────────────────────────
  describe('createErrorCode', () => {
    it('should create and return new error code', async () => {
      const row = { id: 1, code: 'NEW_CODE', category: 'system', severity: 'error' };
      const chain = createInsertChain([row]);
      mocks.insert.mockReturnValue(chain);

      const result = await createErrorCode({
        code: 'NEW_CODE',
        category: 'system',
        severity: 'error',
        titleJa: 'テストエラー',
        descriptionJa: '説明',
        resolutionJa: '解決策',
      });

      expect(result).toEqual(row);
    });

    it('should handle null descriptionJa and resolutionJa', async () => {
      const row = { id: 2, code: 'NEW2', category: 'auth', severity: 'warning' };
      const chain = createInsertChain([row]);
      mocks.insert.mockReturnValue(chain);

      const result = await createErrorCode({
        code: 'NEW2',
        category: 'auth',
        severity: 'warning',
        titleJa: 'テスト',
      });

      expect(result).toEqual(row);
    });

    it('should return null when insert returns empty', async () => {
      const chain = createInsertChain([]);
      mocks.insert.mockReturnValue(chain);

      const result = await createErrorCode({
        code: 'FAIL',
        category: 'system',
        severity: 'error',
        titleJa: 'テスト',
      });

      expect(result).toBeNull();
    });

    it('should return null on DB error', async () => {
      mocks.insert.mockImplementation(() => {
        throw new Error('Unique constraint violation');
      });

      const result = await createErrorCode({
        code: 'DUP',
        category: 'system',
        severity: 'error',
        titleJa: 'テスト',
      });

      expect(result).toBeNull();
      expect(mocks.loggerError).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────
  // updateErrorCode
  // ────────────────────────────────────────────────────
  describe('updateErrorCode', () => {
    it('should update and return error code', async () => {
      const row = { id: 1, code: 'UPDATED', severity: 'warning' };
      const chain = createUpdateChain([row]);
      mocks.update.mockReturnValue(chain);

      const result = await updateErrorCode(1, { severity: 'warning' });

      expect(result).toEqual(row);
    });

    it('should return null when no row is updated', async () => {
      const chain = createUpdateChain([]);
      mocks.update.mockReturnValue(chain);

      const result = await updateErrorCode(999, { titleJa: '不存在' });

      expect(result).toBeNull();
    });

    it('should return null on DB error', async () => {
      mocks.update.mockImplementation(() => {
        throw new Error('DB write failed');
      });

      const result = await updateErrorCode(1, { isActive: false });

      expect(result).toBeNull();
      expect(mocks.loggerError).toHaveBeenCalled();
    });

    it('should handle multiple update fields', async () => {
      const row = { id: 1, code: 'MULTI', category: 'upload', severity: 'info' };
      const chain = createUpdateChain([row]);
      mocks.update.mockReturnValue(chain);

      const result = await updateErrorCode(1, {
        category: 'upload',
        severity: 'info',
        titleJa: '新タイトル',
        descriptionJa: '新説明',
        resolutionJa: '新解決策',
        isActive: true,
      });

      expect(result).toEqual(row);
    });
  });

  // ────────────────────────────────────────────────────
  // seedInitialErrorCodes
  // ────────────────────────────────────────────────────
  describe('seedInitialErrorCodes', () => {
    it('should seed codes and return inserted count', async () => {
      const chain = createInsertChain({ rowCount: 14 });
      mocks.insert.mockReturnValue(chain);

      const result = await seedInitialErrorCodes();

      expect(result).toBe(14);
      expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('14'));
    });

    it('should return 0 when all codes already exist', async () => {
      const chain = createInsertChain({ rowCount: 0 });
      mocks.insert.mockReturnValue(chain);

      const result = await seedInitialErrorCodes();

      expect(result).toBe(0);
      expect(mocks.loggerInfo).not.toHaveBeenCalled();
    });

    it('should return 0 when rowCount is undefined', async () => {
      const chain = createInsertChain({ rowCount: undefined });
      mocks.insert.mockReturnValue(chain);

      const result = await seedInitialErrorCodes();

      expect(result).toBe(0);
    });

    it('should return 0 on DB error', async () => {
      mocks.insert.mockImplementation(() => {
        throw new Error('Seed failed');
      });

      const result = await seedInitialErrorCodes();

      expect(result).toBe(0);
      expect(mocks.loggerError).toHaveBeenCalled();
    });
  });
});
