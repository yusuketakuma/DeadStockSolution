import { api } from './client';
import type {
  TimelineResponse,
  TimelineUnreadResponse,
  TimelinePriority,
  TimelineBootstrapResponse,
} from '../types/timeline';

export interface TimelineParams {
  cursor?: string;
  limit?: number;
  priority?: TimelinePriority;
  since?: string;
}

function buildQuery(params: TimelineParams): string {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.priority) qs.set('priority', params.priority);
  if (params.since) qs.set('since', params.since);
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export const timelineApi = {
  getTimeline: (params: TimelineParams = {}) =>
    api.get<TimelineResponse>(`/timeline${buildQuery(params)}`),

  getBootstrap: (params: TimelineParams = {}) =>
    api.get<TimelineBootstrapResponse>(`/timeline/bootstrap${buildQuery(params)}`),

  getUnreadCount: () =>
    api.get<TimelineUnreadResponse>('/timeline/unread-count'),

  markViewed: () =>
    api.patch<{ success: boolean }>('/timeline/mark-viewed'),

  getDigest: () =>
    api.get<{ events: import('../types/timeline').TimelineEvent[] }>('/timeline/digest'),
};
