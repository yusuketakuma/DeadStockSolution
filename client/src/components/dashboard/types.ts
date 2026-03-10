export interface UploadStatus {
  deadStockUploaded: boolean;
  usedMedicationUploaded: boolean;
  lastDeadStockUpload: string | null;
  lastUsedMedicationUpload: string | null;
}

export interface Notice {
  id: string;
  type: 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message' | 'match_update' | 'new_comment';
  title: string;
  body: string;
  actionPath: string;
  actionLabel: string;
  createdAt: string | null;
  deadlineAt?: string | null;
  unread: boolean;
  priority: number;
}

interface NotificationSummary {
  unreadMessages: number;
  actionableRequests: number;
  total: number;
}

export interface NotificationsResponse {
  notices: Notice[];
  summary: NotificationSummary;
}

export interface NextAction {
  title: string;
  description: string;
  primaryLabel: string;
  primaryPath: string;
  secondaryLabel: string;
  secondaryPath: string;
  badge: 'warning' | 'primary' | 'success';
}

export function noticeVariant(type: Notice['type']): string {
  if (type === 'inbound_request') return 'danger';
  if (type === 'status_update') return 'warning';
  if (type === 'match_update') return 'primary';
  if (type === 'admin_message') return 'info';
  if (type === 'new_comment') return 'success';
  return 'secondary';
}

export function noticeTypeLabel(type: Notice['type']): string {
  if (type === 'admin_message') return '管理者メッセージ';
  if (type === 'match_update') return '候補更新';
  if (type === 'new_comment') return 'コメント';
  return '交換通知';
}
