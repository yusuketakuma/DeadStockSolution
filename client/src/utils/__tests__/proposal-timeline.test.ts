import { describe, it, expect } from 'vitest';
import {
  PROPOSAL_TIMELINE_FILTER_OPTIONS,
  shouldShowProposalTimelineEvent,
  filterProposalTimelineEvents,
} from '../proposal-timeline';

describe('PROPOSAL_TIMELINE_FILTER_OPTIONS', () => {
  it('has 2 options with correct values', () => {
    expect(PROPOSAL_TIMELINE_FILTER_OPTIONS).toHaveLength(2);
    expect(PROPOSAL_TIMELINE_FILTER_OPTIONS[0]).toEqual({ value: 'all', label: 'すべて表示' });
    expect(PROPOSAL_TIMELINE_FILTER_OPTIONS[1]).toEqual({ value: 'decision', label: '承認/拒否/完了のみ' });
  });
});

describe('shouldShowProposalTimelineEvent', () => {
  it('returns true for any action when filter is all', () => {
    expect(shouldShowProposalTimelineEvent('proposal_accept', 'all')).toBe(true);
    expect(shouldShowProposalTimelineEvent('proposal_create', 'all')).toBe(true);
    expect(shouldShowProposalTimelineEvent('random_action', 'all')).toBe(true);
  });

  it('returns true for decision actions when filter is decision', () => {
    expect(shouldShowProposalTimelineEvent('proposal_accept', 'decision')).toBe(true);
    expect(shouldShowProposalTimelineEvent('proposal_reject', 'decision')).toBe(true);
    expect(shouldShowProposalTimelineEvent('proposal_complete', 'decision')).toBe(true);
  });

  it('returns false for non-decision actions when filter is decision', () => {
    expect(shouldShowProposalTimelineEvent('proposal_create', 'decision')).toBe(false);
    expect(shouldShowProposalTimelineEvent('proposal_update', 'decision')).toBe(false);
  });
});

describe('filterProposalTimelineEvents', () => {
  const events = [
    { action: 'proposal_create', label: 'created' },
    { action: 'proposal_accept', label: 'accepted' },
    { action: 'proposal_reject', label: 'rejected' },
    { action: 'proposal_update', label: 'updated' },
    { action: 'proposal_complete', label: 'completed' },
  ];

  it('returns all events when filter is all', () => {
    expect(filterProposalTimelineEvents(events, 'all')).toEqual(events);
  });

  it('returns only decision events when filter is decision', () => {
    const result = filterProposalTimelineEvents(events, 'decision');
    expect(result).toEqual([
      { action: 'proposal_accept', label: 'accepted' },
      { action: 'proposal_reject', label: 'rejected' },
      { action: 'proposal_complete', label: 'completed' },
    ]);
  });

  it('returns empty array when input is empty', () => {
    expect(filterProposalTimelineEvents([], 'all')).toEqual([]);
    expect(filterProposalTimelineEvents([], 'decision')).toEqual([]);
  });
});
