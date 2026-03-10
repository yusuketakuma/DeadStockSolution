import { describe, it, expect } from 'vitest';
import { proposalStatusStyle } from '../proposal-status';

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
