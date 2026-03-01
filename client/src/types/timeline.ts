export type TimelinePriority = 'critical' | 'high' | 'medium' | 'low';

export type TimelineSource =
  | 'notification'
  | 'activity'
  | 'match'
  | 'proposal'
  | 'comment'
  | 'feedback'
  | 'upload'
  | 'admin_message'
  | 'exchange_history'
  | 'expiry_risk';

export type TimelineEventType =
  | 'match_update'
  | 'new_comment'
  | 'exchange_feedback'
  | 'admin_message'
  | 'exchange_completed'
  | 'near_expiry'
  | 'proposal_proposed'
  | 'proposal_accepted_a'
  | 'proposal_accepted_b'
  | 'proposal_confirmed'
  | 'proposal_rejected'
  | 'proposal_completed'
  | 'proposal_cancelled'
  | 'proposal_received'
  | 'proposal_status_changed'
  | 'upload_dead_stock'
  | 'upload_used_medication'
  | 'request_update';

export interface TimelineEvent {
  id: string;
  source: TimelineSource;
  type: TimelineEventType;
  title: string;
  body: string;
  timestamp: string;
  priority: TimelinePriority;
  isRead: boolean;
  actionPath?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  total: number;
  hasMore: boolean;
  nextCursor?: string | null;
  limit?: number;
  pagination?: {
    mode: 'cursor';
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface TimelineUnreadResponse {
  unreadCount: number;
}

export interface TimelineBootstrapResponse {
  timeline: TimelineResponse;
  digest: {
    events: TimelineEvent[];
  };
  unreadCount: number;
}

export interface SmartDigestItem {
  event: TimelineEvent;
  actionLabel: string;
  actionPath: string;
}
