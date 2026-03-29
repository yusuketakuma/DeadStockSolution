import { describe, expect, it, vi, afterEach } from 'vitest';
import { getProposalDeadlineMeta } from '../utils/proposal-expiry';

describe('proposal-expiry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks expired deadlines with a visible overdue label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));

    expect(getProposalDeadlineMeta('2026-03-28T11:00:00.000Z')).toEqual({
      isExpired: true,
      isDueSoon: false,
      remainingLabel: '期限切れ',
      urgencyLabel: '期限超過',
    });
  });

  it('marks near deadlines with a visible due soon label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));

    expect(getProposalDeadlineMeta('2026-03-28T18:00:00.000Z')).toEqual({
      isExpired: false,
      isDueSoon: true,
      remainingLabel: '残り6時間',
      urgencyLabel: '期限間近',
    });
  });
});
