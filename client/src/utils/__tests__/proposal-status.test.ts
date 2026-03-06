import { describe, it, expect } from 'vitest';
import { proposalStatusLabel, toViewerProposalStatusLabel, proposalStatusStyle } from '../proposal-status';

describe('proposalStatusLabel', () => {
  it('returns label for proposed', () => {
    expect(proposalStatusLabel('proposed')).toBe('仮マッチング中');
  });

  it('returns label for accepted_a', () => {
    expect(proposalStatusLabel('accepted_a')).toBe('A側承認済み');
  });

  it('returns label for accepted_b', () => {
    expect(proposalStatusLabel('accepted_b')).toBe('B側承認済み');
  });

  it('returns label for confirmed', () => {
    expect(proposalStatusLabel('confirmed')).toBe('確定');
  });

  it('returns label for rejected', () => {
    expect(proposalStatusLabel('rejected')).toBe('拒否');
  });

  it('returns label for completed', () => {
    expect(proposalStatusLabel('completed')).toBe('交換完了');
  });

  it('returns label for cancelled', () => {
    expect(proposalStatusLabel('cancelled')).toBe('キャンセル');
  });

  it('returns unknown status as-is', () => {
    expect(proposalStatusLabel('unknown_status')).toBe('unknown_status');
  });
});

describe('toViewerProposalStatusLabel', () => {
  it('returns あなた承認済み for accepted_a when viewer is A', () => {
    expect(toViewerProposalStatusLabel('accepted_a', true)).toBe('あなた承認済み');
  });

  it('returns 相手承認済み for accepted_a when viewer is B', () => {
    expect(toViewerProposalStatusLabel('accepted_a', false)).toBe('相手承認済み');
  });

  it('returns 相手承認済み for accepted_b when viewer is A', () => {
    expect(toViewerProposalStatusLabel('accepted_b', true)).toBe('相手承認済み');
  });

  it('returns あなた承認済み for accepted_b when viewer is B', () => {
    expect(toViewerProposalStatusLabel('accepted_b', false)).toBe('あなた承認済み');
  });

  it('delegates to proposalStatusLabel for other statuses', () => {
    expect(toViewerProposalStatusLabel('confirmed', true)).toBe('確定');
    expect(toViewerProposalStatusLabel('rejected', false)).toBe('拒否');
  });
});

describe('proposalStatusStyle', () => {
  it('returns style for proposed', () => {
    expect(proposalStatusStyle('proposed')).toEqual({ label: '仮マッチング中', variant: 'warning' });
  });

  it('returns style for confirmed', () => {
    expect(proposalStatusStyle('confirmed')).toEqual({ label: '確定', variant: 'success' });
  });

  it('returns style for completed', () => {
    expect(proposalStatusStyle('completed')).toEqual({ label: '完了', variant: 'secondary' });
  });

  it('returns default style for unknown status', () => {
    expect(proposalStatusStyle('unknown_status')).toEqual({ label: 'unknown_status', variant: 'secondary' });
  });
});
