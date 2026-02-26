import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProposalPriority, sortByPriority } from '../services/proposal-priority-service';

describe('proposal-priority-service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds urgency score for inbound proposal near deadline', () => {
    const result = getProposalPriority({
      id: 10,
      pharmacyAId: 1,
      pharmacyBId: 2,
      status: 'proposed',
      proposedAt: '2026-02-27T00:00:00.000Z',
    }, 2);

    expect(result.priorityScore).toBeGreaterThanOrEqual(90);
    expect(result.priorityReasons).toEqual(expect.arrayContaining(['あなたの承認待ち', '承認期限が24時間以内']));
    expect(result.deadlineAt).toBe('2026-03-02T00:00:00.000Z');
  });

  it('adds overdue reason when deadline is passed', () => {
    const result = getProposalPriority({
      id: 11,
      pharmacyAId: 1,
      pharmacyBId: 2,
      status: 'accepted_a',
      proposedAt: '2026-02-20T09:00:00.000Z',
    }, 2);

    expect(result.priorityReasons).toEqual(expect.arrayContaining(['あなたの承認待ち', '承認期限を超過']));
    expect(result.priorityScore).toBe(100);
  });

  it('sorts by score then deadline then timestamp', () => {
    const rows = [
      {
        id: 1,
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
        proposedAt: '2026-03-01T10:00:00.000Z',
        priorityScore: 80,
        priorityReasons: ['A'],
        deadlineAt: '2026-03-05T10:00:00.000Z',
      },
      {
        id: 2,
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
        proposedAt: '2026-03-01T11:00:00.000Z',
        priorityScore: 95,
        priorityReasons: ['B'],
        deadlineAt: '2026-03-06T10:00:00.000Z',
      },
      {
        id: 3,
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
        proposedAt: '2026-03-01T09:00:00.000Z',
        priorityScore: 95,
        priorityReasons: ['C'],
        deadlineAt: '2026-03-04T10:00:00.000Z',
      },
    ];

    const ordered = sortByPriority(rows).map((row) => row.id);

    expect(ordered).toEqual([3, 2, 1]);
  });
});
