import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

import { enqueueUploadConfirmJob } from '../services/upload-confirm-job-service';

function createCountSelectChain(count: number) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue([{ count }]);
  return query;
}

describe('upload-confirm-job-service enqueue locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquires both global and pharmacy advisory locks before queue checks', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi
        .fn()
        .mockImplementationOnce(() => createCountSelectChain(0))
        .mockImplementationOnce(() => createCountSelectChain(0)),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 123 }]),
        }),
      }),
    };
    mocks.db.transaction.mockImplementation(async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx));

    const jobId = await enqueueUploadConfirmJob({
      pharmacyId: 7,
      uploadType: 'dead_stock',
      originalFilename: 'dead-stock.xlsx',
      headerRowIndex: 0,
      mapping: {
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: '3',
        expiration_date: '4',
      },
      applyMode: 'replace',
      deleteMissing: false,
      fileBuffer: Buffer.from('dummy-file'),
    });

    expect(jobId).toBe(123);
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });
});
