import { describe, expect, it } from 'vitest';
import {
  buildProposalTimeline,
  type ProposalTimelineActionRow,
} from '../services/proposal-timeline-service';

describe('proposal-timeline-service', () => {
  it('builds timeline with status transitions when enabled', () => {
    const actionRows: ProposalTimelineActionRow[] = [
      {
        action: 'proposal_accept',
        detail: 'proposalId=10|status=accepted_a',
        createdAt: '2026-02-28T10:10:00.000Z',
        actorPharmacyId: 2,
        actorName: '相手薬局',
      },
      {
        action: 'proposal_complete',
        detail: 'proposalId=10|status=completed',
        createdAt: '2026-02-28T11:10:00.000Z',
        actorPharmacyId: 1,
        actorName: '自薬局',
      },
    ];

    const timeline = buildProposalTimeline({
      proposedAt: '2026-02-28T10:00:00.000Z',
      proposalCreatorPharmacyId: 1,
      proposalCreatorName: '提案元薬局',
      actionRows,
      includeStatusTransitions: true,
    });

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({
      action: 'proposal_created',
      label: '仮マッチング作成',
      statusFrom: null,
      statusTo: 'proposed',
    });
    expect(timeline[1]).toMatchObject({
      action: 'proposal_accept',
      label: '承認',
      statusFrom: 'proposed',
      statusTo: 'accepted_a',
    });
    expect(timeline[2]).toMatchObject({
      action: 'proposal_complete',
      label: '交換完了',
      statusFrom: 'accepted_a',
      statusTo: 'completed',
    });
  });

  it('builds timeline without status transitions when disabled', () => {
    const actionRows: ProposalTimelineActionRow[] = [
      {
        action: 'proposal_reject',
        detail: 'proposalId=11|status=rejected',
        createdAt: '2026-02-28T10:30:00.000Z',
        actorPharmacyId: null,
        actorName: null,
      },
    ];

    const timeline = buildProposalTimeline({
      proposedAt: '2026-02-28T10:00:00.000Z',
      proposalCreatorPharmacyId: 11,
      actionRows,
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      action: 'proposal_created',
      actorName: '提案元薬局',
    });
    expect('statusFrom' in timeline[0]).toBe(false);
    expect('statusTo' in timeline[1]).toBe(false);
    expect(timeline[1]).toMatchObject({
      action: 'proposal_reject',
      label: '拒否',
      actorName: '不明',
    });
  });
});
