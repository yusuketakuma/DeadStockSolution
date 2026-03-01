export type ProposalTimelineFilter = 'all' | 'decision';

export interface ProposalTimelineEvent {
  action: string;
  label: string;
  at: string | null;
  actorPharmacyId: number | null;
  actorName: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
}

export const PROPOSAL_TIMELINE_FILTER_OPTIONS: Array<{
  value: ProposalTimelineFilter;
  label: string;
}> = [
  { value: 'all', label: 'すべて表示' },
  { value: 'decision', label: '承認/拒否/完了のみ' },
];

const DECISION_TIMELINE_ACTION_SET = new Set([
  'proposal_accept',
  'proposal_reject',
  'proposal_complete',
]);

export function shouldShowProposalTimelineEvent(
  action: string,
  filter: ProposalTimelineFilter,
): boolean {
  return filter === 'all' || DECISION_TIMELINE_ACTION_SET.has(action);
}

export function filterProposalTimelineEvents<T extends { action: string }>(
  events: T[],
  filter: ProposalTimelineFilter,
): T[] {
  return events.filter((event) => shouldShowProposalTimelineEvent(event.action, filter));
}
