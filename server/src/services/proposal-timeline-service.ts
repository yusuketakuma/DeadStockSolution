import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { activityLogs, pharmacies } from '../db/schema';

const PROPOSAL_TIMELINE_ACTIONS = [
  'proposal_accept',
  'proposal_reject',
  'proposal_complete',
  'proposal_create',
] as const;

type ProposalTimelineAction = (typeof PROPOSAL_TIMELINE_ACTIONS)[number];

export interface ProposalTimelineActionRow {
  action: ProposalTimelineAction | string;
  detail: string | null;
  createdAt: string | null;
  actorPharmacyId: number | null;
  actorName: string | null;
}

export interface ProposalTimelineEvent {
  action: string;
  label: string;
  at: string | null;
  actorPharmacyId: number | null;
  actorName: string;
  statusFrom?: string | null;
  statusTo?: string | null;
}

interface BuildProposalTimelineParams {
  proposedAt: string | null;
  proposalCreatorPharmacyId: number | null;
  proposalCreatorName?: string | null;
  actionRows: ProposalTimelineActionRow[];
  includeStatusTransitions?: boolean;
}

function toTimelineLabel(action: string): string {
  if (action === 'proposal_accept') return '承認';
  if (action === 'proposal_reject') return '拒否';
  if (action === 'proposal_complete') return '交換完了';
  return 'ステータス更新';
}

function resolveNextStatus(action: string, detail: string | null): string | null {
  if (action === 'proposal_accept') {
    return detail?.match(/status=([^|]+)/)?.[1] ?? 'accepted';
  }
  if (action === 'proposal_reject') {
    return 'rejected';
  }
  if (action === 'proposal_complete') {
    return 'completed';
  }
  return null;
}

export async function fetchProposalTimelineActionRows(proposalId: number): Promise<ProposalTimelineActionRow[]> {
  return db.select({
    action: activityLogs.action,
    detail: activityLogs.detail,
    createdAt: activityLogs.createdAt,
    actorPharmacyId: activityLogs.pharmacyId,
    actorName: pharmacies.name,
  })
    .from(activityLogs)
    .leftJoin(pharmacies, eq(activityLogs.pharmacyId, pharmacies.id))
    .where(and(
      inArray(activityLogs.action, PROPOSAL_TIMELINE_ACTIONS),
      sql`${activityLogs.detail} LIKE ${`proposalId=${proposalId}|%`}`,
    ))
    .orderBy(asc(activityLogs.createdAt), asc(activityLogs.id));
}

export function buildProposalTimeline({
  proposedAt,
  proposalCreatorPharmacyId,
  proposalCreatorName,
  actionRows,
  includeStatusTransitions = false,
}: BuildProposalTimelineParams): ProposalTimelineEvent[] {
  let previousStatus = 'proposed';
  const createdEvent: ProposalTimelineEvent = {
    action: 'proposal_created',
    label: '仮マッチング作成',
    at: proposedAt,
    actorPharmacyId: proposalCreatorPharmacyId,
    actorName: proposalCreatorName ?? '提案元薬局',
  };
  if (includeStatusTransitions) {
    createdEvent.statusFrom = null;
    createdEvent.statusTo = 'proposed';
  }

  return [
    createdEvent,
    ...actionRows.map((row) => {
      const nextStatus = resolveNextStatus(row.action, row.detail);
      const event: ProposalTimelineEvent = {
        action: row.action,
        label: toTimelineLabel(row.action),
        at: row.createdAt,
        actorPharmacyId: row.actorPharmacyId,
        actorName: row.actorName ?? '不明',
      };
      if (includeStatusTransitions) {
        event.statusFrom = nextStatus ? previousStatus : null;
        event.statusTo = nextStatus;
      }
      if (nextStatus) {
        previousStatus = nextStatus;
      }
      return event;
    }),
  ];
}
