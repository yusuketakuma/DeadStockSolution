export type NoticeType = 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message' | 'match_update' | 'new_comment' | 'alert';

export interface NoticeItem {
  id: string;
  type: NoticeType;
  title: string;
  body: string;
  actionPath: string;
  actionLabel: string;
  createdAt: string | null;
  deadlineAt: string | null;
  unread: boolean;
  priority: number;
}

export interface NoticeCursor {
  id: string;
  priority: number;
  createdAt: string | null;
}

export interface MatchDiffJson {
  addedPharmacyIds?: unknown;
  removedPharmacyIds?: unknown;
  beforeCount?: unknown;
  afterCount?: unknown;
}

export interface ProposalNotificationLink {
  id: number;
  isRead: boolean;
  createdAt: string | null;
}

export interface AdminMessageRow {
  id: number;
  title: string;
  body: string;
  actionPath: string | null;
  createdAt: string | null;
}

export interface ProposalRow {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  status: string;
  proposedAt: string | null;
}

export interface NotificationRowForProposalLink {
  id: number;
  type: string;
  referenceType: string | null;
  referenceId: number | null;
  isRead: boolean;
  createdAt: string | null;
}

export interface NotificationNoticeRow extends NotificationRowForProposalLink {
  title: string;
  message: string;
}
