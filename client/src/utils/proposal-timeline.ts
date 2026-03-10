export interface ProposalTimelineEvent {
  action: string;
  label: string;
  at: string | null;
  actorPharmacyId: number | null;
  actorName: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  eventType?: 'status_change' | 'comment' | 'feedback' | 'item_detail';
}
