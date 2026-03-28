import { api } from './client';

export type NoticeType =
  | 'inbound_request'
  | 'outbound_request'
  | 'status_update'
  | 'admin_message'
  | 'match_update'
  | 'new_comment';

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

export interface NoticesResponse {
  notices: NoticeItem[];
  summary: {
    unreadMessages: number;
    actionableRequests: number;
    total: number;
  };
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

function extractPrefixedId(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const value = Number(id.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const fetchNotices = (cursor?: string, limit = 20) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return api.get<NoticesResponse>(`/notifications?${params.toString()}`);
};

export const markAllNoticesRead = () =>
  api.patch<{ message: string; count: number }>('/notifications/read-all');

export async function markNoticeRead(id: string): Promise<boolean> {
  const notificationId = extractPrefixedId(id, 'notification-');
  if (notificationId) {
    await api.patch(`/notifications/${notificationId}/read`);
    return true;
  }

  const messageId = extractPrefixedId(id, 'message-');
  if (messageId) {
    await api.post(`/notifications/messages/${messageId}/read`);
    return true;
  }

  const matchId = extractPrefixedId(id, 'match-');
  if (matchId) {
    await api.post(`/notifications/matches/${matchId}/read`);
    return true;
  }

  return false;
}
