import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    dbSelect: vi.fn(),
    dbInsert: vi.fn(),
    dbUpdate: vi.fn(),
    dbDelete: vi.fn(),
  };
});

const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockReturning = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();
const mockOrderBy = vi.fn();
const mockOffset = vi.fn();
const mockOnConflictDoNothing = vi.fn();

vi.mock('../config/database', () => ({
  db: {
    select: (...args: unknown[]) => {
      mocks.dbSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          mockFrom(...fArgs);
          return {
            where: (...wArgs: unknown[]) => {
              const whereResult = mockWhere(...wArgs);
              const chainResult = {
                limit: (...lArgs: unknown[]) => {
                  mockLimit(...lArgs);
                  return mockLimit.mock.results[mockLimit.mock.calls.length - 1]?.value ?? [];
                },
                orderBy: (...oArgs: unknown[]) => {
                  mockOrderBy(...oArgs);
                  return {
                    limit: (...lArgs: unknown[]) => {
                      mockLimit(...lArgs);
                      return {
                        offset: (...offArgs: unknown[]) => {
                          mockOffset(...offArgs);
                          return mockOffset.mock.results[mockOffset.mock.calls.length - 1]?.value ?? [];
                        },
                      };
                    },
                  };
                },
                // Make thenable for direct await (e.g., findEquivalentDrugNames)
                then: (resolve: (v: unknown) => void) => resolve(whereResult ?? []),
              };
              return chainResult;
            },
            orderBy: (...oArgs: unknown[]) => {
              mockOrderBy(...oArgs);
              return {
                limit: (...lArgs: unknown[]) => {
                  mockLimit(...lArgs);
                  return {
                    offset: (...offArgs: unknown[]) => {
                      mockOffset(...offArgs);
                      return mockOffset.mock.results[mockOffset.mock.calls.length - 1]?.value ?? [];
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    insert: (...args: unknown[]) => {
      mocks.dbInsert(...args);
      return {
        values: (...vArgs: unknown[]) => {
          mockValues(...vArgs);
          return {
            returning: (...rArgs: unknown[]) => {
              mockReturning(...rArgs);
              return mockReturning.mock.results[mockReturning.mock.calls.length - 1]?.value ?? [];
            },
            onConflictDoNothing: (...cArgs: unknown[]) => {
              mockOnConflictDoNothing(...cArgs);
              return {
                returning: (...rArgs: unknown[]) => {
                  mockReturning(...rArgs);
                  return mockReturning.mock.results[mockReturning.mock.calls.length - 1]?.value ?? [];
                },
              };
            },
          };
        },
      };
    },
    update: (...args: unknown[]) => {
      mocks.dbUpdate(...args);
      return {
        set: (...sArgs: unknown[]) => {
          mockSet(...sArgs);
          return {
            where: (...wArgs: unknown[]) => {
              mockWhere(...wArgs);
              return {
                returning: (...rArgs: unknown[]) => {
                  mockReturning(...rArgs);
                  return mockReturning.mock.results[mockReturning.mock.calls.length - 1]?.value ?? [];
                },
              };
            },
          };
        },
      };
    },
    delete: (...args: unknown[]) => {
      mocks.dbDelete(...args);
      return {
        where: (...wArgs: unknown[]) => {
          mockWhere(...wArgs);
          return {
            returning: (...rArgs: unknown[]) => {
              mockReturning(...rArgs);
              return mockReturning.mock.results[mockReturning.mock.calls.length - 1]?.value ?? [];
            },
          };
        },
      };
    },
  },
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  createDrugEquivalence,
  getDrugEquivalenceById,
  listDrugEquivalences,
  updateDrugEquivalence,
  deleteDrugEquivalence,
  findEquivalentDrugNames,
  DrugEquivalenceValidationError,
  DrugEquivalenceDuplicateError,
} from '../services/drug-master/equivalence-service';

const sampleRow = {
  id: 1,
  drugNameA: 'アスピリン',
  drugNameB: 'バイアスピリン',
  equivalenceType: 'brand_generic' as const,
  notes: 'テスト備考',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

describe('DrugEquivalenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDrugEquivalence', () => {
    it('正常に同等性ペアを作成できる', async () => {
      // 重複チェック: 既存なし
      mockLimit.mockReturnValueOnce([]);
      mockLimit.mockReturnValueOnce([]);
      // insert
      mockReturning.mockReturnValueOnce([sampleRow]);

      const result = await createDrugEquivalence({
        drugNameA: 'アスピリン',
        drugNameB: 'バイアスピリン',
        equivalenceType: 'brand_generic',
        notes: 'テスト備考',
      });

      expect(result).toEqual(sampleRow);
      expect(mocks.dbInsert).toHaveBeenCalled();
    });

    it('A-B と B-A の重複を検出しエラーを投げる', async () => {
      // A-B存在しない
      mockLimit.mockReturnValueOnce([]);
      // B-A存在する
      mockLimit.mockReturnValueOnce([sampleRow]);

      await expect(
        createDrugEquivalence({
          drugNameA: 'バイアスピリン',
          drugNameB: 'アスピリン',
          equivalenceType: 'brand_generic',
        }),
      ).rejects.toThrow(DrugEquivalenceDuplicateError);
    });

    it('drugNameA が空の場合バリデーションエラー', async () => {
      await expect(
        createDrugEquivalence({
          drugNameA: '',
          drugNameB: 'バイアスピリン',
          equivalenceType: 'brand_generic',
        }),
      ).rejects.toThrow(DrugEquivalenceValidationError);
    });

    it('drugNameA と drugNameB が同じ場合バリデーションエラー', async () => {
      await expect(
        createDrugEquivalence({
          drugNameA: 'アスピリン',
          drugNameB: 'アスピリン',
          equivalenceType: 'brand_generic',
        }),
      ).rejects.toThrow(DrugEquivalenceValidationError);
    });

    it('不正な equivalenceType の場合バリデーションエラー', async () => {
      await expect(
        createDrugEquivalence({
          drugNameA: 'アスピリン',
          drugNameB: 'バイアスピリン',
          equivalenceType: 'invalid_type' as 'brand_generic',
        }),
      ).rejects.toThrow(DrugEquivalenceValidationError);
    });
  });

  describe('getDrugEquivalenceById', () => {
    it('IDで同等性ペアを取得できる', async () => {
      mockLimit.mockReturnValueOnce([sampleRow]);

      const result = await getDrugEquivalenceById(1);
      expect(result).toEqual(sampleRow);
    });

    it('存在しないIDの場合nullを返す', async () => {
      mockLimit.mockReturnValueOnce([]);

      const result = await getDrugEquivalenceById(999);
      expect(result).toBeNull();
    });
  });

  describe('listDrugEquivalences', () => {
    it('一覧を取得できる', async () => {
      mockOffset.mockReturnValueOnce([sampleRow]);

      const result = await listDrugEquivalences();
      expect(result).toEqual([sampleRow]);
    });

    it('limit/offset パラメータが渡される', async () => {
      mockOffset.mockReturnValueOnce([]);

      await listDrugEquivalences({ limit: 10, offset: 20 });
      expect(mockLimit).toHaveBeenCalledWith(10);
      expect(mockOffset).toHaveBeenCalledWith(20);
    });
  });

  describe('updateDrugEquivalence', () => {
    it('既存レコードを更新できる', async () => {
      const updatedRow = { ...sampleRow, notes: '更新後の備考' };
      mockReturning.mockReturnValueOnce([updatedRow]);

      const result = await updateDrugEquivalence(1, { notes: '更新後の備考' });
      expect(result).toEqual(updatedRow);
    });

    it('存在しないIDの場合nullを返す', async () => {
      mockReturning.mockReturnValueOnce([]);

      const result = await updateDrugEquivalence(999, { notes: 'test' });
      expect(result).toBeNull();
    });
  });

  describe('deleteDrugEquivalence', () => {
    it('既存レコードを削除できる', async () => {
      mockReturning.mockReturnValueOnce([sampleRow]);

      const result = await deleteDrugEquivalence(1);
      expect(result).toBe(true);
    });

    it('存在しないIDの場合falseを返す', async () => {
      mockReturning.mockReturnValueOnce([]);

      const result = await deleteDrugEquivalence(999);
      expect(result).toBe(false);
    });
  });

  describe('findEquivalentDrugNames', () => {
    it('指定した薬品名の同等薬品名一覧を返す', async () => {
      // or() で検索 → where() が直接結果を返す
      mockWhere.mockReturnValueOnce([
        { ...sampleRow, drugNameA: 'アスピリン', drugNameB: 'バイアスピリン' },
        { ...sampleRow, id: 2, drugNameA: 'アスピリン100mg', drugNameB: 'アスピリン' },
      ]);

      const result = await findEquivalentDrugNames('アスピリン');
      expect(result).toContain('バイアスピリン');
      expect(result).toContain('アスピリン100mg');
    });

    it('同等薬品名がない場合空配列を返す', async () => {
      mockWhere.mockReturnValueOnce([]);

      const result = await findEquivalentDrugNames('存在しない薬品');
      expect(result).toEqual([]);
    });
  });
});
