// 共通型は server から re-export（Single Source of Truth）
export type {
  TimelinePriority,
  TimelineSource,
  TimelineEventType,
  TimelineEvent,
  EnrichedProposalTimelineEvent,
} from '@server-types/timeline';

import type { TimelineEvent } from '@server-types/timeline';

// client 固有の型（server 側と構造が異なるためローカル定義）
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
