import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// db mock must be hoisted before app.ts is imported
const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbExecute: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: { select: mocks.dbSelect, execute: mocks.dbExecute },
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getOpenClawHealthSnapshot } from '../services/openclaw-health-service';

// Helper: build a chainable select mock that resolves to `rows`
function mockSelectReturning(rows: Array<Record<string, unknown>>) {
  mocks.dbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

// Helper: build multi-call select mock
// First call = openclawRetryJobs (retry queue), second call = openclawRequestEvents (handoff KPI)
function mockSelectSequence(
  retryRows: Array<{ status: string }>,
  handoffRows: Array<{ eventType: string; createdAt: string }>,
) {
  let callCount = 0;
  mocks.dbSelect.mockImplementation(() => {
    callCount += 1;
    if (callCount === 1) {
      // retry queue: select({ status }) .from().  — no where clause
      return {
        from: vi.fn().mockResolvedValue(retryRows),
      };
    }
    // handoff KPI: select().from().where()
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(handoffRows),
      }),
    };
  });
}

const ORIGINAL_ENV = { ...process.env };

describe('getOpenClawHealthSnapshot — handoff KPI fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbExecute.mockResolvedValue([]);
  });

  afterEach(() => {
    // Restore env vars
    for (const key of ['OPENCLAW_CONNECTOR_MODE', 'OPENCLAW_CLI_PATH', 'OPENCLAW_AGENT_ID', 'OPENCLAW_WEBHOOK_SECRET']) {
      if (key in ORIGINAL_ENV) {
        process.env[key] = ORIGINAL_ENV[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('handoffSuccessRate と lastHandoffAt が snapshot に含まれる', async () => {
    mockSelectSequence(
      [],
      [
        { eventType: 'handoff_accepted', createdAt: '2026-03-20T10:00:00.000Z' },
        { eventType: 'handoff_deferred', createdAt: '2026-03-21T12:00:00.000Z' },
      ],
    );

    const snapshot = await getOpenClawHealthSnapshot();

    expect(snapshot).toHaveProperty('handoffSuccessRate');
    expect(snapshot).toHaveProperty('lastHandoffAt');
  });

  it('handoff イベントが存在しない場合、handoffSuccessRate と lastHandoffAt は null', async () => {
    mockSelectSequence([], []);

    const snapshot = await getOpenClawHealthSnapshot();

    expect(snapshot.handoffSuccessRate).toBeNull();
    expect(snapshot.lastHandoffAt).toBeNull();
  });

  it('全イベントが handoff_accepted の場合、successRate は 1', async () => {
    mockSelectSequence(
      [],
      [
        { eventType: 'handoff_accepted', createdAt: '2026-03-20T09:00:00.000Z' },
        { eventType: 'handoff_accepted', createdAt: '2026-03-20T10:00:00.000Z' },
      ],
    );

    const snapshot = await getOpenClawHealthSnapshot();

    expect(snapshot.handoffSuccessRate).toBe(1);
  });

  it('全イベントが handoff_deferred の場合、successRate は 0', async () => {
    mockSelectSequence(
      [],
      [
        { eventType: 'handoff_deferred', createdAt: '2026-03-19T08:00:00.000Z' },
      ],
    );

    const snapshot = await getOpenClawHealthSnapshot();

    expect(snapshot.handoffSuccessRate).toBe(0);
  });

  it('accepted と deferred が混在する場合、successRate は正しい割合になる', async () => {
    mockSelectSequence(
      [],
      [
        { eventType: 'handoff_accepted', createdAt: '2026-03-20T10:00:00.000Z' },
        { eventType: 'handoff_accepted', createdAt: '2026-03-20T11:00:00.000Z' },
        { eventType: 'handoff_deferred', createdAt: '2026-03-20T12:00:00.000Z' },
      ],
    );

    const snapshot = await getOpenClawHealthSnapshot();

    // 2 accepted / 3 total = 0.666...
    expect(snapshot.handoffSuccessRate).toBeCloseTo(2 / 3);
  });

  it('lastHandoffAt は最も新しいイベントの createdAt になる', async () => {
    mockSelectSequence(
      [],
      [
        { eventType: 'handoff_accepted', createdAt: '2026-03-20T10:00:00.000Z' },
        { eventType: 'handoff_deferred', createdAt: '2026-03-22T15:30:00.000Z' },
        { eventType: 'handoff_accepted', createdAt: '2026-03-21T08:00:00.000Z' },
      ],
    );

    const snapshot = await getOpenClawHealthSnapshot();

    expect(snapshot.lastHandoffAt).toBe('2026-03-22T15:30:00.000Z');
  });
});
