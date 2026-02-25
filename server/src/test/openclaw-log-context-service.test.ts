import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenClawLogContext } from '../services/openclaw-log-context-service';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

const ENV_KEYS = [
  'OPENCLAW_LOG_CONTEXT_WINDOW_HOURS',
  'OPENCLAW_LOG_CONTEXT_RECENT_FAILURE_LIMIT',
  'OPENCLAW_LOG_CONTEXT_RECENT_ACTIVITY_LIMIT',
  'OPENCLAW_LOG_CONTEXT_DETAIL_MAX_LENGTH',
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
for (const key of ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function mockFailureCount(count: number): void {
  const whereMock = vi.fn().mockResolvedValue([{ count }]);
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockFailureByAction(rows: Array<{ action: string; count: number }>): void {
  const groupByMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockFailureByReason(rows: Array<{ reason: string; count: number }>): void {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const groupByMock = vi.fn(() => ({ orderBy: orderByMock }));
  const whereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockRecentRows(rows: Array<{ action: string; detail: string | null; createdAt: string; pharmacyId: number | null }>): void {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

describe('openclaw-log-context-service', () => {
  afterEach(() => {
    vi.clearAllMocks();
    restoreEnv();
  });

  it('builds summarized log context for OpenClaw handoff', async () => {
    process.env.OPENCLAW_LOG_CONTEXT_DETAIL_MAX_LENGTH = '80';
    const now = new Date('2026-02-25T01:23:45.000Z');

    mockFailureCount(4);
    mockFailureByAction([
      { action: 'upload', count: 3 },
      { action: 'drug_master_sync', count: 1 },
    ]);
    mockFailureByReason([
      { reason: 'parse_failed', count: 3 },
      { reason: 'sync_failed', count: 1 },
    ]);
    mockRecentRows([
      {
        action: 'upload',
        detail: '失敗|phase=preview|reason=parse_failed|error=very very long detail text for truncation',
        createdAt: '2026-02-25T01:20:00.000Z',
        pharmacyId: 10,
      },
    ]);
    mockRecentRows([
      {
        action: 'proposal_create',
        detail: ' 提案作成   ',
        createdAt: '2026-02-25T01:19:00.000Z',
        pharmacyId: 42,
      },
    ]);

    const result = await buildOpenClawLogContext(42, now);

    expect(result.generatedAt).toBe('2026-02-25T01:23:45.000Z');
    expect(result.windowHours).toBe(24);
    expect(result.importFailures.total).toBe(4);
    expect(result.importFailures.byAction).toEqual([
      { action: 'upload', count: 3 },
      { action: 'drug_master_sync', count: 1 },
    ]);
    expect(result.importFailures.byReason[0]).toEqual({ reason: 'parse_failed', count: 3 });
    expect(result.importFailures.recent[0].detail).toContain('失敗|phase=preview|reason=parse_failed');
    expect(result.importFailures.recent[0].detail).toContain('...');
    expect(String(result.importFailures.recent[0].detail).length).toBeLessThanOrEqual(83);
    expect(result.pharmacyActivity.pharmacyId).toBe(42);
    expect(result.pharmacyActivity.recent[0].detail).toBe('提案作成');
  });
});
