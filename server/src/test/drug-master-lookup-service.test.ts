import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => ({})),
  desc: vi.fn((col: unknown) => col),
  eq: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(() => ({})),
}));

vi.mock('../utils/kana-utils', () => ({
  katakanaToHiragana: vi.fn((s: string) => s),
  hiraganaToKatakana: vi.fn((s: string) => s),
  normalizeKana: vi.fn((s: string) => s),
}));

vi.mock('../utils/package-utils', () => ({
  normalizePackageInfo: vi.fn().mockReturnValue({
    normalizedPackageLabel: 'normalized-label',
    packageForm: 'tablet',
    isLoosePackage: false,
  }),
}));

import {
  searchDrugMaster,
  lookupByCode,
  getDrugMasterStats,
  getDrugDetail,
  getSyncLogs,
  updateDrugMasterItem,
} from '../services/drug-master-lookup-service';

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

describe('drug-master-lookup-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchDrugMaster', () => {
    it('returns empty array for empty query', async () => {
      const result = await searchDrugMaster('');
      expect(result).toEqual([]);
    });

    it('returns empty array for whitespace-only query', async () => {
      const result = await searchDrugMaster('   ');
      expect(result).toEqual([]);
    });

    it('searches by drug name', async () => {
      const expected = [
        {
          id: 1,
          yjCode: '111111111111',
          drugName: 'テスト薬',
          genericName: null,
          specification: null,
          unit: null,
          yakkaPrice: '10.5',
          manufacturer: null,
          category: null,
          isListed: true,
          transitionDeadline: null,
        },
      ];
      const chain = createSelectChain(expected);
      mocks.db.select.mockReturnValue(chain);

      const result = await searchDrugMaster('テスト');
      expect(result).toHaveLength(1);
      expect(result[0].drugName).toBe('テスト薬');
    });

    it('searches by code when query looks like code', async () => {
      const chain = createSelectChain([]);
      mocks.db.select.mockReturnValue(chain);

      const result = await searchDrugMaster('111111');
      expect(result).toHaveLength(0);
    });

    it('clamps limit to range [1, 100]', async () => {
      const chain = createSelectChain([]);
      mocks.db.select.mockReturnValue(chain);

      await searchDrugMaster('テスト', 200);
      expect(chain.limit).toHaveBeenCalledWith(100);
    });

    it('clamps limit to minimum 1', async () => {
      const chain = createSelectChain([]);
      mocks.db.select.mockReturnValue(chain);

      await searchDrugMaster('テスト', 0);
      expect(chain.limit).toHaveBeenCalledWith(1);
    });
  });

  describe('lookupByCode', () => {
    it('returns drug master by YJ code', async () => {
      const expected = { id: 1, yjCode: '111111111111', drugName: 'テスト薬' };
      const chain = createSelectChain([expected]);
      mocks.db.select.mockReturnValue(chain);

      const result = await lookupByCode('111111111111');
      expect(result).toEqual(expected);
    });

    it('looks up by package code when YJ code not found', async () => {
      let callNum = 0;
      mocks.db.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          // YJ code lookup - not found
          return createSelectChain([]);
        }
        if (callNum === 2) {
          // Package code lookup - found
          return createSelectChain([{ drugMasterId: 42 }]);
        }
        // Drug master by id
        return createSelectChain([{ id: 42, yjCode: '222222222222', drugName: '薬B' }]);
      });

      const result = await lookupByCode('14987123456789');
      expect(result).not.toBeNull();
      expect(result!.id).toBe(42);
    });

    it('returns null when code not found anywhere', async () => {
      mocks.db.select.mockImplementation(() => createSelectChain([]));

      const result = await lookupByCode('NONEXISTENT');
      expect(result).toBeNull();
    });

    it('cleans hyphens and spaces from code', async () => {
      const chain = createSelectChain([]);
      mocks.db.select.mockReturnValue(chain);

      await lookupByCode('111-111-111 111');
      // Should normalize the code
      expect(mocks.db.select).toHaveBeenCalled();
    });
  });

  describe('getDrugMasterStats', () => {
    it('returns statistics', async () => {
      let callNum = 0;
      mocks.db.select.mockImplementation(() => {
        callNum++;
        // count queries: select().from() where from() is terminal
        // The code does [result] = await db.select({value: count()}).from(drugMaster)
        // Then optionally .where()
        const chain = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };

        if (callNum <= 4) {
          // count queries: from() returns a chainable/promiseable object
          const whereChain = {
            where: vi.fn().mockResolvedValue([{ value: callNum * 100 }]),
            then: (resolve: (v: unknown) => void) => Promise.resolve([{ value: callNum * 100 }]).then(resolve),
          };
          chain.from.mockReturnValue(whereChain);
          return chain;
        }
        // last sync query: select().from().where().orderBy().limit()
        chain.from.mockReturnValue(chain);
        chain.where.mockReturnValue(chain);
        chain.orderBy.mockReturnValue(chain);
        chain.limit.mockResolvedValue([{ startedAt: '2026-03-01T00:00:00Z' }]);
        return chain;
      });

      const stats = await getDrugMasterStats();
      expect(stats.totalItems).toBeDefined();
    });
  });

  describe('getDrugDetail', () => {
    it('returns null when drug not found', async () => {
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await getDrugDetail('NONEXISTENT');
      expect(result).toBeNull();
    });

    it('returns drug with packages and price history', async () => {
      let callNum = 0;
      mocks.db.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          // drug master
          const chain = {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  yjCode: '111111111111',
                  drugName: 'テスト薬',
                },
              ]),
            }),
          };
          return chain;
        }
        if (callNum === 2) {
          // packages
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  id: 10,
                  drugMasterId: 1,
                  packageDescription: '100錠',
                  packageQuantity: 100,
                  packageUnit: '錠',
                  normalizedPackageLabel: null,
                  packageForm: null,
                  isLoosePackage: null,
                },
              ]),
            }),
          };
        }
        // price history
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: 20,
                  yjCode: '111111111111',
                  previousPrice: '10.0',
                  newPrice: '12.0',
                  revisionDate: '2026-04-01',
                },
              ]),
            }),
          }),
        };
      });

      const result = await getDrugDetail('111111111111');
      expect(result).not.toBeNull();
      expect(result!.packages).toHaveLength(1);
      expect(result!.priceHistory).toHaveLength(1);
    });
  });

  describe('getSyncLogs', () => {
    it('returns sync logs with default limit', async () => {
      const chain = createSelectChain([{ id: 1, syncType: 'auto' }]);
      mocks.db.select.mockReturnValue(chain);

      const result = await getSyncLogs();
      expect(result).toHaveLength(1);
    });

    it('clamps limit to range [1, 100]', async () => {
      const chain = createSelectChain([]);
      mocks.db.select.mockReturnValue(chain);

      await getSyncLogs(200);
      expect(chain.limit).toHaveBeenCalledWith(100);
    });

    it('clamps limit to minimum 1', async () => {
      const chain = createSelectChain([]);
      mocks.db.select.mockReturnValue(chain);

      await getSyncLogs(0);
      expect(chain.limit).toHaveBeenCalledWith(1);
    });
  });

  describe('updateDrugMasterItem', () => {
    it('updates drug master item and returns result', async () => {
      const updatedItem = { id: 1, yjCode: '111111111111', drugName: '更新薬' };
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedItem]),
          }),
        }),
      });

      const result = await updateDrugMasterItem('111111111111', {
        drugName: '更新薬',
      });
      expect(result).toEqual(updatedItem);
    });

    it('returns null when item not found', async () => {
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await updateDrugMasterItem('NONEXISTENT', {
        drugName: '更新薬',
      });
      expect(result).toBeNull();
    });

    it('converts yakkaPrice to string', async () => {
      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      });
      mocks.db.update.mockReturnValue({ set: setMock });

      await updateDrugMasterItem('111111111111', { yakkaPrice: 25.5 });
      const setCall = setMock.mock.calls[0][0];
      expect(setCall.yakkaPrice).toBe('25.5');
    });

    it('does not set yakkaPrice when undefined', async () => {
      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      });
      mocks.db.update.mockReturnValue({ set: setMock });

      await updateDrugMasterItem('111111111111', { drugName: '薬A' });
      const setCall = setMock.mock.calls[0][0];
      expect(setCall.yakkaPrice).toBeUndefined();
    });
  });
});
