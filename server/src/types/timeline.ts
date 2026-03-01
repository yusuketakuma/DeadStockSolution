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
  id: string; // '{source}_{tableId}' e.g. 'notification_42'
  source: TimelineSource;
  type: string; // action type or notification type
  title: string;
  body: string;
  timestamp: string; // ISO string
  priority: TimelinePriority;
  isRead: boolean;
  actionPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RawTimelineEvent {
  id: string;
  source: TimelineSource;
  type: string;
  title: string;
  body: string;
  timestamp: string;
  isRead: boolean;
  actionPath?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  total: number;
  hasMore: boolean;
}

export interface TimelineUnreadCount {
  unreadCount: number;
}
