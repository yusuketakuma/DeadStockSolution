import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { columnMappingTemplates, deadStockItems, uploads, usedMedicationItems } from '../db/schema';
import { setupVitestMocks } from './helpers/setup';

const mocks = vi.hoisted(() => {
  const state = {
    uploads: [] as Array<Record<string, unknown>>,
    deadStockRows: [] as Array<Record<string, unknown>>,
    usedMedicationRows: [] as Array<Record<string, unknown>>,
    templates: [] as Array<Record<string, unknown>>,
    uploadSeq: 100,
    deadStockSeq: 1000,
    usedMedicationSeq: 2000,
  };

  const reset = () => {
    state.uploads.length = 0;
    state.deadStockRows.length = 0;
    state.usedMedicationRows.length = 0;
    state.templates.length = 0;
    state.uploadSeq = 100;
    state.deadStockSeq = 1000;
    state.usedMedicationSeq = 2000;
  };

  const db = {
    select: vi.fn(),
    transaction: vi.fn(),
  };

  return {
    state,
    reset,
    db,
    parseExcelBuffer: vi.fn(),
    enrichWithDrugMaster: vi.fn(),
    triggerMatchingRefreshOnUpload: vi.fn(),
    writeLog: vi.fn(),
    getClientIp: vi.fn(),
  };
});

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'flow@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/upload-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/upload-service')>();
  return {
    ...actual,
    parseExcelBuffer: mocks.parseExcelBuffer,
  };
});

vi.mock('../services/drug-master-enrichment', () => ({
  enrichWithDrugMaster: mocks.enrichWithDrugMaster,
}));

vi.mock('../services/matching-refresh-service', () => ({
  triggerMatchingRefreshOnUpload: mocks.triggerMatchingRefreshOnUpload,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

import uploadRouter from '../routes/upload';
import inventoryRouter from '../routes/inventory';

function createApp() {
  const app = express();
  app.use('/api/upload', uploadRouter);
  app.use('/api/inventory', inventoryRouter);
  return app;
}

function attachXlsxFile(
  reqBuilder: request.Test,
  filename: string = 'data.xlsx',
): request.Test {
  return reqBuilder.attach('file', Buffer.from('dummy-xlsx-content'), {
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function setupDbMock() {
  mocks.db.select.mockImplementation((shape?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === columnMappingTemplates) {
        return {
          where: () => ({
            limit: async (n: number) => mocks.state.templates.slice(0, n),
          }),
        };
      }

      if (table === deadStockItems) {
        if (shape && 'count' in shape) {
          return {
            where: async () => [{ count: mocks.state.deadStockRows.length }],
          };
        }

        return {
          where: () => ({
            orderBy: () => ({
              limit: (limit: number) => ({
                offset: async (offset: number) => {
                  const rows = [...mocks.state.deadStockRows]
                    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
                  return rows.slice(offset, offset + limit);
                },
              }),
            }),
          }),
        };
      }

      if (table === usedMedicationItems) {
        if (shape && 'count' in shape) {
          return {
            where: async () => [{ count: mocks.state.usedMedicationRows.length }],
          };
        }

        return {
          where: () => ({
            orderBy: () => ({
              limit: (limit: number) => ({
                offset: async (offset: number) => {
                  const rows = [...mocks.state.usedMedicationRows]
                    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
                  return rows.slice(offset, offset + limit);
                },
              }),
            }),
          }),
        };
      }

      return {
        where: () => ({
          limit: async () => [],
        }),
      };
    },
  }));

  mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: (_shape?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          if (table === uploads) {
            return {
              where: () => ({
                orderBy: () => ({
                  limit: async (n: number) => {
                    if (n <= 0) return [];
                    const sorted = [...mocks.state.uploads]
                      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
                    return sorted.slice(0, n);
                  },
                }),
              }),
            };
          }
          return {
            where: () => ({
              limit: async () => [],
            }),
          };
        },
      }),
      insert: (table: unknown) => {
        if (table === uploads) {
          return {
            values: (value: Record<string, unknown>) => {
              const row = {
                id: ++mocks.state.uploadSeq,
                createdAt: new Date().toISOString(),
                ...value,
              };
              mocks.state.uploads.push(row);
              return {
                returning: async () => [{ id: row.id }],
              };
            },
          };
        }

        if (table === deadStockItems) {
          return {
            values: async (value: Array<Record<string, unknown>> | Record<string, unknown>) => {
              const rows = Array.isArray(value) ? value : [value];
              for (const item of rows) {
                mocks.state.deadStockRows.push({
                  id: ++mocks.state.deadStockSeq,
                  createdAt: new Date().toISOString(),
                  ...item,
                });
              }
            },
          };
        }

        if (table === usedMedicationItems) {
          return {
            values: async (value: Array<Record<string, unknown>> | Record<string, unknown>) => {
              const rows = Array.isArray(value) ? value : [value];
              for (const item of rows) {
                mocks.state.usedMedicationRows.push({
                  id: ++mocks.state.usedMedicationSeq,
                  createdAt: new Date().toISOString(),
                  ...item,
                });
              }
            },
          };
        }

        if (table === columnMappingTemplates) {
          return {
            values: (value: Record<string, unknown>) => ({
              onConflictDoUpdate: async () => {
                const idx = mocks.state.templates.findIndex((t) =>
                  t.pharmacyId === value.pharmacyId
                  && t.uploadType === value.uploadType
                  && t.headerHash === value.headerHash
                );
                if (idx >= 0) {
                  mocks.state.templates[idx] = value;
                } else {
                  mocks.state.templates.push(value);
                }
              },
            }),
          };
        }

        return {
          values: async () => undefined,
        };
      },
      delete: (table: unknown) => ({
        where: async () => {
          if (table === deadStockItems) {
            mocks.state.deadStockRows.length = 0;
          } else if (table === usedMedicationItems) {
            mocks.state.usedMedicationRows.length = 0;
          }
        },
      }),
      update: (table: unknown) => ({
        set: (value: Record<string, unknown>) => ({
          where: async () => {
            if (table === uploads && mocks.state.uploads.length > 0) {
              Object.assign(mocks.state.uploads[mocks.state.uploads.length - 1], value);
            }
          },
        }),
      }),
    };

    return callback(tx);
  });
}

describe('upload -> inventory flow', () => {
  setupVitestMocks();

  beforeEach(() => {
    mocks.reset();
    setupDbMock();

    mocks.parseExcelBuffer.mockResolvedValue([
      ['YJコード', '薬剤名', '数量', '単位'],
      ['1111111F1111', 'アムロジピン錠5mg', 10, '錠'],
      ['2222222F2222', 'ロキソプロフェン錠60mg', 5, '錠'],
    ]);
    mocks.enrichWithDrugMaster.mockImplementation(async (rows: unknown[]) => rows);
    mocks.triggerMatchingRefreshOnUpload.mockResolvedValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('reflects confirmed upload in dead stock list endpoint', async () => {
    const app = createApp();

    const previewResponse = await attachXlsxFile(request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock'), 'dead-stock.xlsx');

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toEqual(expect.objectContaining({
      headers: ['YJコード', '薬剤名', '数量', '単位'],
      headerRowIndex: 0,
    }));

    const confirmResponse = await attachXlsxFile(request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .field('mapping', JSON.stringify({
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: '3',
        yakka_unit_price: null,
        expiration_date: null,
        lot_number: null,
      })), 'dead-stock.xlsx');

    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body).toEqual(expect.objectContaining({
      rowCount: 2,
    }));

    const listResponse = await request(app).get('/api/inventory/dead-stock');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.pagination.total).toBe(2);
    expect(listResponse.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ drugName: 'アムロジピン錠5mg', quantity: 10 }),
      expect.objectContaining({ drugName: 'ロキソプロフェン錠60mg', quantity: 5 }),
    ]));
  });

  it('reflects confirmed upload in used medication list endpoint', async () => {
    const app = createApp();
    mocks.parseExcelBuffer.mockResolvedValue([
      ['YJコード', '薬剤名', '使用量', '単位'],
      ['1111111F1111', 'アムロジピン錠5mg', 120, '錠'],
      ['2222222F2222', 'ロキソプロフェン錠60mg', 60, '錠'],
    ]);

    const previewResponse = await attachXlsxFile(request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'used_medication'), 'used-medication.xlsx');

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toEqual(expect.objectContaining({
      headers: ['YJコード', '薬剤名', '使用量', '単位'],
      headerRowIndex: 0,
    }));

    const confirmResponse = await attachXlsxFile(request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'used_medication')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .field('mapping', JSON.stringify({
        drug_code: '0',
        drug_name: '1',
        monthly_usage: '2',
        unit: '3',
        yakka_unit_price: null,
      })), 'used-medication.xlsx');

    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body).toEqual(expect.objectContaining({
      rowCount: 2,
    }));

    const listResponse = await request(app).get('/api/inventory/used-medication');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.pagination.total).toBe(2);
    expect(listResponse.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ drugName: 'アムロジピン錠5mg', monthlyUsage: 120 }),
      expect.objectContaining({ drugName: 'ロキソプロフェン錠60mg', monthlyUsage: 60 }),
    ]));
  });

  it('returns bad request on preview when excel parsing fails', async () => {
    const app = createApp();
    mocks.parseExcelBuffer.mockRejectedValueOnce(new Error('broken'));

    const response = await attachXlsxFile(request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock'), 'broken.xlsx');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
  });

  it('returns bad request on confirm when headerRowIndex is invalid', async () => {
    const app = createApp();

    const response = await attachXlsxFile(request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', 'invalid')
      .field('applyMode', 'replace')
      .field('mapping', JSON.stringify({
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: '3',
        yakka_unit_price: null,
        expiration_date: null,
        lot_number: null,
      })), 'dead-stock.xlsx');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ヘッダー行指定が不正です' });
  });
});
