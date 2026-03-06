import { describe, expect, it, vi } from 'vitest';
import {
  getProposalPriority,
  sortByPriority,
  type ProposalPriorityInput,
  type ProposalPriority,
} from '../services/proposal-priority-service';

// ── Helpers ──

function makeInput(overrides: Partial<ProposalPriorityInput> = {}): ProposalPriorityInput {
  return {
    id: 1,
    pharmacyAId: 100,
    pharmacyBId: 200,
    status: 'proposed',
    proposedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('proposal-priority-deep', () => {
  // ── getProposalPriority — status branches ──

  describe('getProposalPriority status branches', () => {
    it('returns high priority for inbound proposed (viewer is pharmacyB)', () => {
      const recentProposedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
      const result = getProposalPriority(
        makeInput({ status: 'proposed', pharmacyAId: 100, pharmacyBId: 200, proposedAt: recentProposedAt }),
        200,
      );

      expect(result.priorityScore).toBe(85);
      expect(result.priorityReasons).toContain('あなたの承認待ち');
    });

    it('returns medium priority for outbound proposed (viewer is pharmacyA)', () => {
      const result = getProposalPriority(
        makeInput({ status: 'proposed', pharmacyAId: 100, pharmacyBId: 200 }),
        100,
      );

      expect(result.priorityScore).toBe(45);
      expect(result.priorityReasons).toContain('相手薬局の承認待ち');
    });

    it('returns confirmed priority', () => {
      const result = getProposalPriority(
        makeInput({ status: 'confirmed' }),
        100,
      );

      expect(result.priorityScore).toBe(70);
      expect(result.priorityReasons).toContain('確定済み・交換完了待ち');
    });

    it('returns accepted_a priority for inbound viewer (pharmacyB)', () => {
      const recentProposedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
      const result = getProposalPriority(
        makeInput({ status: 'accepted_a', pharmacyAId: 100, pharmacyBId: 200, proposedAt: recentProposedAt }),
        200,
      );

      expect(result.priorityScore).toBe(85);
      expect(result.priorityReasons).toContain('あなたの承認待ち');
    });

    it('returns accepted_a priority for outbound viewer (pharmacyA, not inbound)', () => {
      const result = getProposalPriority(
        makeInput({ status: 'accepted_a', pharmacyAId: 100, pharmacyBId: 200 }),
        100,
      );

      // accepted_a but viewer is pharmacyA → not inbound waiting
      // Falls through to the general accepted_a/accepted_b branch
      expect(result.priorityScore).toBe(55);
      expect(result.priorityReasons).toContain('片側承認済み');
    });

    it('returns accepted_b priority for inbound viewer (pharmacyA)', () => {
      const recentProposedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
      const result = getProposalPriority(
        makeInput({ status: 'accepted_b', pharmacyAId: 100, pharmacyBId: 200, proposedAt: recentProposedAt }),
        100,
      );

      expect(result.priorityScore).toBe(85);
      expect(result.priorityReasons).toContain('あなたの承認待ち');
    });

    it('returns accepted_b priority for outbound viewer (pharmacyB, not inbound)', () => {
      const result = getProposalPriority(
        makeInput({ status: 'accepted_b', pharmacyAId: 100, pharmacyBId: 200 }),
        200,
      );

      expect(result.priorityScore).toBe(55);
      expect(result.priorityReasons).toContain('片側承認済み');
    });

    it('returns completed priority', () => {
      const result = getProposalPriority(
        makeInput({ status: 'completed' }),
        100,
      );

      expect(result.priorityScore).toBe(10);
      expect(result.priorityReasons).toContain('完了済み');
    });

    it('returns rejected priority', () => {
      const result = getProposalPriority(
        makeInput({ status: 'rejected' }),
        100,
      );

      expect(result.priorityScore).toBe(5);
      expect(result.priorityReasons).toContain('終了済み');
    });

    it('returns cancelled priority', () => {
      const result = getProposalPriority(
        makeInput({ status: 'cancelled' }),
        100,
      );

      expect(result.priorityScore).toBe(5);
      expect(result.priorityReasons).toContain('終了済み');
    });

    it('returns default reasons for unknown status', () => {
      const result = getProposalPriority(
        makeInput({ status: 'unknown_status' }),
        100,
      );

      expect(result.priorityScore).toBe(0);
      expect(result.priorityReasons).toEqual(['通常優先度']);
    });
  });

  // ── getProposalPriority — deadline branches ──

  describe('getProposalPriority deadline bonuses', () => {
    it('adds 20 when deadline has expired for inbound waiting', () => {
      const pastDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100 hours ago
      const result = getProposalPriority(
        makeInput({
          status: 'proposed',
          pharmacyBId: 200,
          proposedAt: pastDate,
        }),
        200,
      );

      // 85 (inbound) + 20 (expired) = 100 (capped)
      expect(result.priorityScore).toBeGreaterThanOrEqual(100);
      expect(result.priorityReasons).toContain('承認期限を超過');
    });

    it('adds 12 when deadline is within 24 hours for inbound waiting', () => {
      // 72h deadline from proposedAt. Set proposedAt to ~60h ago so remaining ~12h
      const proposedAt = new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString();
      const result = getProposalPriority(
        makeInput({
          status: 'proposed',
          pharmacyBId: 200,
          proposedAt,
        }),
        200,
      );

      // 85 (inbound) + 12 (24h warning) = 97
      expect(result.priorityScore).toBe(97);
      expect(result.priorityReasons).toContain('承認期限が24時間以内');
    });

    it('adds 6 when deadline is within 48 hours for inbound waiting', () => {
      // 72h deadline. Set proposedAt to ~30h ago so remaining ~42h
      const proposedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const result = getProposalPriority(
        makeInput({
          status: 'proposed',
          pharmacyBId: 200,
          proposedAt,
        }),
        200,
      );

      // 85 (inbound) + 6 (48h warning) = 91
      expect(result.priorityScore).toBe(91);
      expect(result.priorityReasons).toContain('承認期限が近い');
    });

    it('does not add deadline bonus when not inbound waiting', () => {
      // Outbound proposed — deadline doesn't add bonus
      const pastDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
      const result = getProposalPriority(
        makeInput({
          status: 'proposed',
          pharmacyAId: 100,
          pharmacyBId: 200,
          proposedAt: pastDate,
        }),
        100,
      );

      // 45 (outbound) + 0 (not inbound) = 45
      expect(result.priorityScore).toBe(45);
      expect(result.priorityReasons).not.toContain('承認期限を超過');
    });

    it('does not add deadline bonus when deadline is far away', () => {
      // Recent proposal — deadline is > 48h away
      const proposedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
      const result = getProposalPriority(
        makeInput({
          status: 'proposed',
          pharmacyBId: 200,
          proposedAt,
        }),
        200,
      );

      // 85 (inbound) + 0 (far deadline) = 85
      expect(result.priorityScore).toBe(85);
    });
  });

  // ── getProposalPriority — edge cases ──

  describe('getProposalPriority edge cases', () => {
    it('returns null deadlineAt when proposedAt is null', () => {
      const result = getProposalPriority(
        makeInput({ proposedAt: null }),
        100,
      );

      expect(result.deadlineAt).toBeNull();
    });

    it('returns null deadlineAt for invalid proposedAt date', () => {
      const result = getProposalPriority(
        makeInput({ proposedAt: 'invalid-date' }),
        100,
      );

      expect(result.deadlineAt).toBeNull();
    });

    it('calculates deadlineAt as proposedAt + 72 hours', () => {
      const proposedAt = '2026-01-01T00:00:00.000Z';
      const result = getProposalPriority(
        makeInput({ proposedAt }),
        100,
      );

      expect(result.deadlineAt).toBe('2026-01-04T00:00:00.000Z');
    });

    it('clamps score to max 100', () => {
      const pastDate = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString();
      const result = getProposalPriority(
        makeInput({
          status: 'proposed',
          pharmacyBId: 200,
          proposedAt: pastDate,
        }),
        200,
      );

      expect(result.priorityScore).toBeLessThanOrEqual(100);
    });

    it('rounds score to 2 decimal places', () => {
      const result = getProposalPriority(
        makeInput({ status: 'completed' }),
        100,
      );

      const scoreStr = result.priorityScore.toString();
      const decimalPart = scoreStr.split('.')[1];
      if (decimalPart) {
        expect(decimalPart.length).toBeLessThanOrEqual(2);
      }
    });

    it('viewer is neither pharmacyA nor pharmacyB for proposed status', () => {
      const result = getProposalPriority(
        makeInput({ status: 'proposed', pharmacyAId: 100, pharmacyBId: 200 }),
        300, // third-party viewer
      );

      // Not inbound, not outbound for proposed
      // Falls through to accepted_a/accepted_b check which also doesn't match
      // Score: 0 (no status match for viewer perspective)
      expect(result.priorityReasons).toEqual(['通常優先度']);
    });
  });

  // ── sortByPriority ──

  describe('sortByPriority', () => {
    type SortableRow = ProposalPriorityInput & ProposalPriority;

    function makeRow(overrides: Partial<SortableRow> = {}): SortableRow {
      return {
        id: 1,
        pharmacyAId: 100,
        pharmacyBId: 200,
        status: 'proposed',
        proposedAt: '2026-01-01T00:00:00.000Z',
        priorityScore: 50,
        priorityReasons: [],
        deadlineAt: null,
        ...overrides,
      };
    }

    it('sorts by priorityScore descending', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 30 }),
        makeRow({ id: 2, priorityScore: 90 }),
        makeRow({ id: 3, priorityScore: 60 }),
      ];

      const sorted = sortByPriority(rows);

      expect(sorted[0].id).toBe(2);
      expect(sorted[1].id).toBe(3);
      expect(sorted[2].id).toBe(1);
    });

    it('uses deadlineAt as tiebreaker (earlier deadline first)', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 85, deadlineAt: '2026-01-05T00:00:00.000Z' }),
        makeRow({ id: 2, priorityScore: 85, deadlineAt: '2026-01-03T00:00:00.000Z' }),
      ];

      const sorted = sortByPriority(rows);

      expect(sorted[0].id).toBe(2); // earlier deadline first
    });

    it('uses proposedAt as tiebreaker when deadlineAt is the same', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 85, deadlineAt: '2026-01-05T00:00:00.000Z', proposedAt: '2026-01-01T00:00:00.000Z' }),
        makeRow({ id: 2, priorityScore: 85, deadlineAt: '2026-01-05T00:00:00.000Z', proposedAt: '2026-01-02T00:00:00.000Z' }),
      ];

      const sorted = sortByPriority(rows);

      expect(sorted[0].id).toBe(2); // later proposedAt first (descending)
    });

    it('uses id as final tiebreaker', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 85, deadlineAt: null, proposedAt: '2026-01-01T00:00:00.000Z' }),
        makeRow({ id: 5, priorityScore: 85, deadlineAt: null, proposedAt: '2026-01-01T00:00:00.000Z' }),
      ];

      const sorted = sortByPriority(rows);

      expect(sorted[0].id).toBe(5); // higher id first (descending)
    });

    it('handles null deadlineAt (treated as Infinity)', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 85, deadlineAt: null }),
        makeRow({ id: 2, priorityScore: 85, deadlineAt: '2026-01-03T00:00:00.000Z' }),
      ];

      const sorted = sortByPriority(rows);

      expect(sorted[0].id).toBe(2); // non-null deadline comes first
    });

    it('handles null proposedAt (treated as 0)', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 50, deadlineAt: null, proposedAt: null }),
        makeRow({ id: 2, priorityScore: 50, deadlineAt: null, proposedAt: '2026-01-01T00:00:00.000Z' }),
      ];

      const sorted = sortByPriority(rows);

      expect(sorted[0].id).toBe(2); // has proposedAt, comes first
    });

    it('returns empty array for empty input', () => {
      const sorted = sortByPriority([]);

      expect(sorted).toEqual([]);
    });

    it('does not mutate original array', () => {
      const rows = [
        makeRow({ id: 1, priorityScore: 30 }),
        makeRow({ id: 2, priorityScore: 90 }),
      ];
      const original = [...rows];

      sortByPriority(rows);

      expect(rows[0].id).toBe(original[0].id);
      expect(rows[1].id).toBe(original[1].id);
    });
  });
});
