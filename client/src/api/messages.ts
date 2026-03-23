import { api } from './client';

export interface MessageThread {
  otherPharmacyId: number;
  otherPharmacyName: string;
  lastMessageBody: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface Message {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface ThreadsResponse {
  data: MessageThread[];
}

export interface ThreadResponse {
  data: Message[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SendMessageResponse {
  message: string;
  data: Message;
}

export interface UnreadCountResponse {
  unreadCount: number;
}

export const fetchThreads = () =>
  api.get<ThreadsResponse>('/messages/threads');

export const fetchThread = (pharmacyId: number, page?: number) =>
  api.get<ThreadResponse>(
    `/messages/thread/${pharmacyId}${page !== undefined ? `?page=${page}` : ''}`,
  );

export const sendMessage = (toPharmacyId: number, body: string) =>
  api.post<SendMessageResponse>('/messages', { toPharmacyId, body });

export const markThreadRead = (pharmacyId: number) =>
  api.patch<{ markedCount: number }>(`/messages/thread/${pharmacyId}/read`);

export const fetchUnreadCount = () =>
  api.get<UnreadCountResponse>('/messages/unread-count');
