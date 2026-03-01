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

export interface TimelineEvent {
  id: string;
  source: TimelineSource;
  type: string;
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
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface TimelineUnreadResponse {
  unreadCount: number;
}

export interface SmartDigestItem {
  event: TimelineEvent;
  actionLabel: string;
  actionPath: string;
}
