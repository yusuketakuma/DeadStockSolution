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
  id: string; // '{source}_{tableId}' e.g. 'notification_42'
  source: TimelineSource;
  type: TimelineEventType;
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
  type: TimelineEventType;
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
  nextCursor?: string | null;
}

export interface TimelineCursor {
  timestamp: string;
  id: string;
}

export interface TimelineUnreadCount {
  unreadCount: number;
}

/** Drizzle ORM db クライアントの緩い型（テスト時のモック注入用） */
export type DbClient = { select: (...args: any[]) => any; update: (...args: any[]) => any };

export const TIMELINE_EVENT_TYPES = new Set<TimelineEventType>([
  'match_update',
  'new_comment',
  'exchange_feedback',
  'admin_message',
  'exchange_completed',
  'near_expiry',
  'proposal_proposed',
  'proposal_accepted_a',
  'proposal_accepted_b',
  'proposal_confirmed',
  'proposal_rejected',
  'proposal_completed',
  'proposal_cancelled',
  'proposal_received',
  'proposal_status_changed',
  'upload_dead_stock',
  'upload_used_medication',
  'request_update',
]);

export function toTimelineEventType(s: string): TimelineEventType {
  if (TIMELINE_EVENT_TYPES.has(s as TimelineEventType)) {
    return s as TimelineEventType;
  }
  console.warn(`[toTimelineEventType] Unknown event type: "${s}", falling back to 'request_update'`);
  return 'request_update';
}
