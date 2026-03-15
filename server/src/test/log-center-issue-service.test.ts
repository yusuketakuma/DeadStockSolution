import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbInsertValues: vi.fn().mockResolvedValue(undefined),
  dbSelectFrom: vi.fn().mockResolvedValue([]),
  buildLogIssueResourceId: vi.fn((source: string, logId: number) => `${source}:${logId}`),
  isLogIssueAuditAction: vi.fn((action: unknown) =>
    action === 'admin_log_status_update' || action === 'admin_log_auto_escalated'),
  extractStatusMetadata: vi.fn((detail: unknown) => ({
    status: (detail as Record<string, unknown>)?.status ?? null,
    note: (detail as Record<string, unknown>)?.note ?? null,
    reasonCodes: (detail as Record<string, unknown>)?.reasonCodes ?? [],
  })),
  parseJsonSafe: vi.fn((v: unknown) => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  }),
  loadPharmacyMap: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../config/database', () => ({
  db: {
    insert: () => ({ values: mocks.dbInsertValues }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: mocks.dbSelectFrom,
        }),
      }),
    }),
  },
}));

vi.mock('../db/schema', () => ({
  activityLogs: {
    id: 'id', pharmacyId: 'pharmacyId', action: 'action',
    resourceId: 'resourceId', resourceType: 'resourceType',
    metadataJson: 'metadataJson', createdAt: 'createdAt',
  },
}));

vi.mock('../services/log-center-service', () => ({
  buildLogIssueResourceId: mocks.buildLogIssueResourceId,
  isLogIssueAuditAction: mocks.isLogIssueAuditAction,
  extractStatusMetadata: mocks.extractStatusMetadata,
  parseJsonSafe: mocks.parseJsonSafe,
  loadPharmacyMap: mocks.loadPharmacyMap,
}));

import {
  updateLogIssueState,
  recordLogIssueAutoEscalation,
  getLogIssueHistory,
} from '../services/log-center-issue-service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbInsertValues.mockResolvedValue(undefined);
  mocks.dbSelectFrom.mockResolvedValue([]);
  mocks.loadPharmacyMap.mockResolvedValue(new Map());
});

describe('updateLogIssueState', () => {
  it('activity_logs に status_update を記録して LogIssueState を返す', async () => {
    const result = await updateLogIssueState({
      source: 'activity_logs' as any,
      logId: 42,
      status: 'investigating' as any,
      actorPharmacyId: 1,
      actorEmail: 'test@example.com',
    });

    expect(mocks.dbInsertValues).toHaveBeenCalledOnce();
    expect(mocks.buildLogIssueResourceId).toHaveBeenCalledWith('activity_logs', 42);
    expect(result.status).toBe('investigating');
    expect(result.note).toBeNull();
    expect(result.updatedBy!.pharmacyId).toBe(1);
    expect(result.updatedBy!.pharmacyEmail).toBe('test@example.com');
  });

  it('note 付きの更新で note をトリムして保存', async () => {
    const result = await updateLogIssueState({
      source: 'system_events' as any,
      logId: 10,
      status: 'resolved' as any,
      note: '  修正済み  ',
      actorPharmacyId: 2,
      actorEmail: 'admin@example.com',
    });

    expect(result.note).toBe('修正済み');
    const callArgs = mocks.dbInsertValues.mock.calls[0][0];
    expect(callArgs.detail).toContain('修正済み');
  });

  it('空白のみの note は null として扱う', async () => {
    const result = await updateLogIssueState({
      source: 'activity_logs' as any,
      logId: 1,
      status: 'new' as any,
      note: '   ',
      actorPharmacyId: 1,
      actorEmail: 'test@example.com',
    });

    expect(result.note).toBeNull();
  });
});

describe('recordLogIssueAutoEscalation', () => {
  it('自動エスカレーションを activity_logs に記録', async () => {
    await recordLogIssueAutoEscalation({
      source: 'activity_logs' as any,
      logId: 99,
      actorPharmacyId: 5,
      note: 'threshold exceeded',
      reasonCodes: ['high_error_rate'],
    });

    expect(mocks.dbInsertValues).toHaveBeenCalledOnce();
    const callArgs = mocks.dbInsertValues.mock.calls[0][0];
    expect(callArgs.action).toBe('admin_log_auto_escalated');
    expect(callArgs.pharmacyId).toBe(5);
    const metadata = JSON.parse(callArgs.metadataJson);
    expect(metadata.reasonCodes).toEqual(['high_error_rate']);
  });

  it('actorPharmacyId が null の場合も記録できる', async () => {
    await recordLogIssueAutoEscalation({
      source: 'system_events' as any,
      logId: 1,
      actorPharmacyId: null,
      reasonCodes: ['timeout'],
    });

    const callArgs = mocks.dbInsertValues.mock.calls[0][0];
    expect(callArgs.pharmacyId).toBeNull();
    expect(callArgs.detail).toBe('auto escalation');
  });
});

describe('getLogIssueHistory', () => {
  it('空のヒストリーを返す', async () => {
    const result = await getLogIssueHistory('activity_logs' as any, 42);
    expect(result).toEqual([]);
  });

  it('status_update のヒストリーを返す', async () => {
    mocks.dbSelectFrom.mockResolvedValue([{
      id: 1, pharmacyId: 10, action: 'admin_log_status_update',
      resourceId: 'activity_logs:42',
      metadataJson: JSON.stringify({ status: 'investigating', note: 'checking' }),
      createdAt: '2026-03-15T00:00:00Z',
    }]);
    mocks.loadPharmacyMap.mockResolvedValue(
      new Map([[10, { id: 10, name: 'テスト薬局', email: 'test@example.com' }]]),
    );

    const result = await getLogIssueHistory('activity_logs' as any, 42);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('status_update');
    expect(result[0].actor?.pharmacyId).toBe(10);
    expect(result[0].actor?.pharmacyName).toBe('テスト薬局');
  });

  it('auto_escalation のヒストリーを返す', async () => {
    mocks.dbSelectFrom.mockResolvedValue([{
      id: 2, pharmacyId: null, action: 'admin_log_auto_escalated',
      resourceId: 'system_events:10',
      metadataJson: JSON.stringify({ reasonCodes: ['high_rate'] }),
      createdAt: '2026-03-15T01:00:00Z',
    }]);

    const result = await getLogIssueHistory('system_events' as any, 10);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('auto_escalation');
    expect(result[0].actor).toBeNull();
  });

  it('pharmacyMap にない pharmacyId は名前なしで返す', async () => {
    mocks.dbSelectFrom.mockResolvedValue([{
      id: 3, pharmacyId: 999, action: 'admin_log_status_update',
      resourceId: 'activity_logs:1', metadataJson: '{}',
      createdAt: '2026-03-15T02:00:00Z',
    }]);

    const result = await getLogIssueHistory('activity_logs' as any, 1);

    expect(result).toHaveLength(1);
    expect(result[0].actor?.pharmacyId).toBe(999);
    expect(result[0].actor?.pharmacyName).toBeNull();
  });
});
