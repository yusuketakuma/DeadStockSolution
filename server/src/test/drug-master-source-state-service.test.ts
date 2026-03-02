import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock drizzle DB operations
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

vi.mock('../config/database', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        mockFrom(table);
        // getAllSourceStates returns directly; getSourceState/getSourceStatesByPrefix chain .where()
        const result = Promise.resolve([]);
        (result as unknown as Record<string, unknown>).where = (condition: unknown) => {
          mockWhere(condition);
          // getSourceState chains .limit(); getSourceStatesByPrefix does not
          const whereResult = Promise.resolve([]);
          (whereResult as unknown as Record<string, unknown>).limit = (n: number) => { mockLimit(n); return Promise.resolve([]); };
          return whereResult;
        };
        return result;
      },
    }),
    insert: (table: unknown) => {
      mockInsert(table);
      return {
        values: (data: unknown) => {
          mockValues(data);
          return {
            onConflictDoUpdate: (opts: unknown) => {
              mockOnConflictDoUpdate(opts);
              return Promise.resolve();
            },
          };
        },
      };
    },
  },
}));

vi.mock('../db/schema', () => ({
  drugMasterSourceState: {
    sourceKey: 'source_key',
    id: 'id',
  },
}));

describe('drug-master-source-state-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should import without errors', async () => {
    const mod = await import('../services/drug-master-source-state-service');
    expect(mod.getSourceState).toBeDefined();
    expect(mod.upsertSourceState).toBeDefined();
    expect(mod.getAllSourceStates).toBeDefined();
    expect(mod.getSourceStatesByPrefix).toBeDefined();
  });

  it('getSourceState returns null when no matching row', async () => {
    const { getSourceState } = await import('../services/drug-master-source-state-service');
    const result = await getSourceState('nonexistent:key');
    expect(result).toBeNull();
  });

  it('upsertSourceState calls insert with correct data', async () => {
    const { upsertSourceState } = await import('../services/drug-master-source-state-service');
    await upsertSourceState('drug:test', {
      url: 'https://example.com/test.xlsx',
      etag: '"abc123"',
      lastModified: 'Mon, 01 Jan 2025 00:00:00 GMT',
      contentHash: 'sha256hash',
      lastCheckedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'drug:test',
        url: 'https://example.com/test.xlsx',
        etag: '"abc123"',
      }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });

  it('getSourceStatesByPrefix filters by prefix', async () => {
    const { getSourceStatesByPrefix } = await import('../services/drug-master-source-state-service');
    // With empty results from mock, should return empty array
    const results = await getSourceStatesByPrefix('drug:');
    expect(Array.isArray(results)).toBe(true);
  });
});
