import { api, buildApiUrl } from './client';

export interface MessageAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface MessageThread {
  otherPharmacyId: number;
  otherPharmacyName: string;
  lastMessageBody: string;
  lastMessageAt: string;
  lastMessageSenderId: number;
  unreadCount: number;
  waitingOn: 'me' | 'them' | null;
  isOverdue: boolean;
  hasAttachments: boolean;
}

export interface Message {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  body: string;
  isRead: boolean;
  readAt: string | null;
  isDeleted: boolean;
  createdAt: string;
  attachments: MessageAttachment[];
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

export const fetchThreads = (search?: string) =>
  api.get<ThreadsResponse>(`/messages/threads${search ? `?search=${encodeURIComponent(search)}` : ''}`);

export const fetchThread = (pharmacyId: number, page?: number) =>
  api.get<ThreadResponse>(
    `/messages/thread/${pharmacyId}${page !== undefined ? `?page=${page}` : ''}`,
  );

export const sendMessage = (toPharmacyId: number, body: string, files: File[] = []) => {
  if (files.length === 0) {
    return api.post<SendMessageResponse>('/messages', { toPharmacyId, body });
  }
  const formData = new FormData();
  formData.set('toPharmacyId', String(toPharmacyId));
  formData.set('body', body);
  files.forEach((file) => formData.append('files', file));
  return api.upload<SendMessageResponse>('/messages', formData);
};

export const markThreadRead = (pharmacyId: number) =>
  api.patch<{ markedCount: number }>(`/messages/thread/${pharmacyId}/read`);

export const fetchUnreadCount = () =>
  api.get<UnreadCountResponse>('/messages/unread-count');

export const getMessageAttachmentDownloadUrl = (attachmentId: number) =>
  buildApiUrl(`/messages/attachments/${attachmentId}`);
