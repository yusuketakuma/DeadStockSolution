import { api } from './client';
import type { TimelineResponse, TimelineUnreadResponse, TimelinePriority } from '../types/timeline';

export interface TimelineParams {
  page?: number;
  limit?: number;
  priority?: TimelinePriority;
  since?: string;
}

function buildQuery(params: TimelineParams): string {
  const parts: string[] = [];
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.priority) parts.push(`priority=${params.priority}`);
  if (params.since) parts.push(`since=${encodeURIComponent(params.since)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const timelineApi = {
  getTimeline: (params: TimelineParams = {}) =>
    api.get<TimelineResponse>(`/timeline${buildQuery(params)}`),

  getUnreadCount: () =>
    api.get<TimelineUnreadResponse>('/timeline/unread-count'),

  markViewed: () =>
    api.patch<{ success: boolean }>('/timeline/mark-viewed'),

  getDigest: () =>
    api.get<{ events: import('../types/timeline').TimelineEvent[] }>('/timeline/digest'),
};
