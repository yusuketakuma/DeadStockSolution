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

function createIdempotencySelectChain(result: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

describe('upload-confirm-job-service enqueue locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquires global and pharmacy advisory locks before queue checks', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockImplementation(() => createCountSelectChain(0)),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 123,
              status: 'pending',
              canceledAt: null,
              cancelRequestedAt: null,
            },
          ]),
        }),
      }),
    };
    mocks.db.transaction.mockImplementation(async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await enqueueUploadConfirmJob({
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

    expect(result).toEqual({
      jobId: 123,
      status: 'pending',
      deduplicated: false,
      cancelable: true,
      canceledAt: null,
    });
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('returns deduplicated existing job when idempotency key matches', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn()
        .mockImplementationOnce(() => createIdempotencySelectChain([
          {
            id: 321,
            pharmacyId: 7,
            uploadType: 'dead_stock',
            originalFilename: 'dead-stock.xlsx',
            idempotencyKey: 'upload-job-key-1234',
            fileHash: 'dd5e9b25ed0dd1edf92d90d7fd8820fc7c9baff06626616db068e3d6172b23ff',
            headerRowIndex: 0,
            mappingJson: JSON.stringify({
              drug_code: '0',
              drug_name: '1',
              quantity: '2',
              unit: '3',
              expiration_date: '4',
            }),
            status: 'pending',
            applyMode: 'replace',
            deleteMissing: false,
            deduplicated: false,
            fileBase64: 'encoded',
            attempts: 0,
            lastError: null,
            resultJson: null,
            cancelRequestedAt: null,
            canceledAt: null,
            canceledBy: null,
            processingStartedAt: null,
            nextRetryAt: null,
            completedAt: null,
            createdAt: '2026-02-28T00:00:00.000Z',
            updatedAt: '2026-02-28T00:00:00.000Z',
          },
        ])),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await enqueueUploadConfirmJob({
      pharmacyId: 7,
      uploadType: 'dead_stock',
      originalFilename: 'dead-stock.xlsx',
      idempotencyKey: 'upload-job-key-1234',
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

    expect(result).toEqual({
      jobId: 321,
      status: 'pending',
      deduplicated: true,
      cancelable: true,
      canceledAt: null,
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
