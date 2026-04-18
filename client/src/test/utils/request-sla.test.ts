import { describe, expect, it } from 'vitest';
import { getRequestSlaSummary } from '../../utils/request-sla';

describe('getRequestSlaSummary', () => {
  const nowMs = Date.parse('2026-04-09T12:00:00.000Z');

  it('builds user-facing SLA info for user waiting items', () => {
    const summary = getRequestSlaSummary({
      waitingOn: 'user',
      isOverdue: false,
      latestUserMessageAt: '2026-04-09T09:00:00.000Z',
      latestStaffMessageAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T10:00:00.000Z',
      createdAt: '2026-04-09T08:00:00.000Z',
    }, nowMs);

    expect(summary.nextActionLabel).toBe('次にやること: 返信する');
    expect(summary.overdue).toBe(false);
    expect(summary.dueLabel).toContain('残り');
    expect(summary.elapsedLabel).toContain('経過');
    expect(summary.tone).toBe('info');
  });

  it('marks overdue items as danger', () => {
    const summary = getRequestSlaSummary({
      waitingOn: 'admin',
      isOverdue: true,
      latestUserMessageAt: '2026-04-08T06:00:00.000Z',
      latestStaffMessageAt: null,
      updatedAt: '2026-04-08T06:00:00.000Z',
      createdAt: '2026-04-08T05:00:00.000Z',
    }, nowMs);

    expect(summary.overdue).toBe(true);
    expect(summary.dueLabel).toContain('超過');
    expect(summary.tone).toBe('danger');
  });

  it('falls back gracefully when timestamps are missing', () => {
    const summary = getRequestSlaSummary({
      waitingOn: null,
      isOverdue: false,
      latestUserMessageAt: null,
      latestStaffMessageAt: null,
      updatedAt: null,
      createdAt: null,
    }, nowMs);

    expect(summary.referenceAt).toBeNull();
    expect(summary.dueAt).toBeNull();
    expect(summary.dueLabel).toBe('目安なし');
    expect(summary.elapsedLabel).toBe('起点時刻なし');
  });
});
