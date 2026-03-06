import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRows = vi.hoisted(() => ({
  fromRows: [] as unknown[],
  whereRows: [] as unknown[],
  valuesPayload: null as unknown,
  conflictPayload: null as unknown,
}));

vi.mock('../config/database', () => ({
  db: {
    select: () => ({
      from: () => {
        const base = Promise.resolve(mockRows.fromRows);
        (base as unknown as Record<string, unknown>).where = () => {
          const whereResult = Promise.resolve(mockRows.whereRows);
          (whereResult as unknown as Record<string, unknown>).limit = () => Promise.resolve(mockRows.whereRows.slice(0, 1));
          return whereResult;
        };
        return base;
      },
    }),
    insert: () => ({
      values: (payload: unknown) => {
        mockRows.valuesPayload = payload;
        return {
          onConflictDoUpdate: (conflictPayload: unknown) => {
            mockRows.conflictPayload = conflictPayload;
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

vi.mock('../db/schema', () => ({
  drugMasterSourceState: {
    sourceKey: 'sourceKey',
  },
}));

describe('drug-master-source-state-service-extra', () => {
  beforeEach(() => {
    mockRows.fromRows = [];
    mockRows.whereRows = [];
    mockRows.valuesPayload = null;
    mockRows.conflictPayload = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T12:00:00.000Z'));
  });

  it('returns first row from getSourceState and full list from getAllSourceStates', async () => {
    mockRows.whereRows = [{ id: 1, sourceKey: 'drug:file:a' }];
    mockRows.fromRows = [{ id: 10, sourceKey: 'drug:file:x' }, { id: 11, sourceKey: 'drug:file:y' }];

    const mod = await import('../services/drug-master-source-state-service');
    await expect(mod.getSourceState('drug:file:a')).resolves.toEqual({ id: 1, sourceKey: 'drug:file:a' });
    await expect(mod.getAllSourceStates()).resolves.toEqual(mockRows.fromRows);
  });

  it('upsertSourceState writes nullable fields and selective update fields', async () => {
    const mod = await import('../services/drug-master-source-state-service');
    await mod.upsertSourceState('drug:file:a', {
      url: 'https://example.com/a.csv',
      etag: null,
      contentHash: 'abc',
    });

    expect(mockRows.valuesPayload).toEqual(expect.objectContaining({
      sourceKey: 'drug:file:a',
      url: 'https://example.com/a.csv',
      etag: null,
      contentHash: 'abc',
      lastModified: null,
    }));
    expect(mockRows.conflictPayload).toEqual(expect.objectContaining({
      set: expect.objectContaining({
        url: 'https://example.com/a.csv',
        etag: null,
        contentHash: 'abc',
      }),
    }));
    expect((mockRows.conflictPayload as { set: Record<string, unknown> }).set.lastModified).toBeUndefined();
  });

  it('persistSourceHeaders sets lastChangedAt only when changed=true', async () => {
    const mod = await import('../services/drug-master-source-state-service');
    await mod.persistSourceHeaders('drug:file:a', 'https://example.com/a.csv', {
      etag: '"tag1"',
      lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
    }, false);

    const unchangedSet = (mockRows.conflictPayload as { set: Record<string, unknown> }).set;
    expect(unchangedSet.lastCheckedAt).toBe('2026-03-04T12:00:00.000Z');
    expect(unchangedSet.lastChangedAt).toBeUndefined();

    await mod.persistSourceHeaders('drug:file:a', 'https://example.com/a.csv', {
      etag: '"tag2"',
      lastModified: 'Tue, 02 Jan 2026 00:00:00 GMT',
      contentHash: 'hash2',
    }, true);

    const changedSet = (mockRows.conflictPayload as { set: Record<string, unknown> }).set;
    expect(changedSet.lastCheckedAt).toBe('2026-03-04T12:00:00.000Z');
    expect(changedSet.lastChangedAt).toBe('2026-03-04T12:00:00.000Z');
    expect(changedSet.contentHash).toBe('hash2');
  });

  it('provides expected source-key helpers and prefix query', async () => {
    mockRows.whereRows = [{ sourceKey: 'drug:file:price' }];
    const mod = await import('../services/drug-master-source-state-service');

    expect(mod.SOURCE_KEY_SINGLE).toBe('drug:single');
    expect(mod.SOURCE_KEY_INDEX).toBe('drug:index_page');
    expect(mod.SOURCE_KEY_PACKAGE).toBe('package:main');
    expect(mod.sourceKeyForFile('price')).toBe('drug:file:price');

    await expect(mod.getSourceStatesByPrefix('drug:file:')).resolves.toEqual([{ sourceKey: 'drug:file:price' }]);
  });
});
