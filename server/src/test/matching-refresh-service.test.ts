import { describe, expect, it, vi } from 'vitest';
import { triggerMatchingRefreshOnUpload } from '../services/matching-refresh-service';

function createSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(rows);
  return chain;
}

function createUpdateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockResolvedValue(undefined);
  return chain;
}

function createDeleteChain() {
  const chain = {
    where: vi.fn(),
  };
  chain.where.mockResolvedValue(undefined);
  return chain;
}

function createInsertChain() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

describe('matching-refresh-service trigger debounce', () => {
  it('inserts a scheduled refresh job when no existing row exists', async () => {
    const insertChain = createInsertChain();
    const executor = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      select: vi.fn().mockImplementation(() => createSelectChain([])),
      update: vi.fn().mockImplementation(() => createUpdateChain()),
      delete: vi.fn().mockImplementation(() => createDeleteChain()),
      insert: vi.fn().mockReturnValue(insertChain),
    };

    await triggerMatchingRefreshOnUpload({ triggerPharmacyId: 10, uploadType: 'dead_stock' }, executor as never);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      triggerPharmacyId: 10,
      uploadType: 'dead_stock',
      attempts: 0,
    }));
    const insertPayload = insertChain.values.mock.calls[0]?.[0] as { nextRetryAt?: unknown } | undefined;
    expect(typeof insertPayload?.nextRetryAt).toBe('string');
    expect(executor.update).not.toHaveBeenCalled();
    expect(executor.delete).not.toHaveBeenCalled();
  });

  it('reuses existing waiting job and deletes redundant waiting rows', async () => {
    const updateChain = createUpdateChain();
    const deleteChain = createDeleteChain();
    const executor = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      select: vi.fn().mockImplementation(() => createSelectChain([
        { id: 101, processingStartedAt: null, attempts: 0 },
        { id: 102, processingStartedAt: null, attempts: 1 },
      ])),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(deleteChain),
      insert: vi.fn().mockReturnValue(createInsertChain()),
    };

    await triggerMatchingRefreshOnUpload({ triggerPharmacyId: 22, uploadType: 'used_medication' }, executor as never);

    expect(executor.insert).not.toHaveBeenCalled();
    expect(executor.update).toHaveBeenCalledTimes(1);
    expect(updateChain.where).toHaveBeenCalledTimes(1);
    const updatePayload = updateChain.set.mock.calls[0]?.[0] as { uploadType?: unknown; nextRetryAt?: unknown } | undefined;
    expect(updatePayload?.uploadType).toBe('used_medication');
    expect(typeof updatePayload?.nextRetryAt).toBe('string');
    expect(executor.delete).toHaveBeenCalledTimes(1);
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });
});
