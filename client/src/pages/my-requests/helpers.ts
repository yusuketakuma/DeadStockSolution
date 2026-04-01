import { buildApiUrl } from '../../api/client';
import type { RequestItem, RequestMessageItem, RequestQueueFilter } from './types';

interface BadgeMeta {
  bg: 'secondary' | 'primary' | 'warning' | 'success' | 'danger' | 'info' | 'dark';
  label: string;
  text?: 'dark';
}

export function statusBadge(status: string | null): BadgeMeta {
  switch (status) {
    case 'awaiting_user':
      return { bg: 'primary', label: '回答待ち' };
    case 'implementing':
      return { bg: 'warning', label: '実装中' };
    case 'pr_opened':
      return { bg: 'warning', label: 'PR作成済み' };
    case 'completed':
      return { bg: 'success', label: '完了' };
    case 'failed':
      return { bg: 'danger', label: '失敗' };
    case 'analyzing':
      return { bg: 'secondary', label: '解析中' };
    case 'queued':
    default:
      return { bg: 'secondary', label: '受付済み' };
  }
}

export function authorLabel(authorType: RequestMessageItem['authorType']): string {
  if (authorType === 'openclaw_agent') return 'DSS Manager';
  if (authorType === 'system') return 'System';
  if (authorType === 'admin') return 'Admin';
  return 'あなた';
}

export function categoryLabel(category: string): string {
  switch (category) {
    case 'bug_report':
      return '不具合';
    case 'question':
      return '質問';
    case 'master_update':
      return 'マスター更新';
    case 'integration_issue':
      return '連携不具合';
    case 'improvement':
    default:
      return '改善要望';
  }
}

export function priorityLabel(priority: string): string {
  switch (priority) {
    case 'urgent':
      return '緊急';
    case 'low':
      return '低';
    case 'normal':
    default:
      return '通常';
  }
}

export function priorityBadge(priority: string): BadgeMeta {
  if (priority === 'urgent') {
    return { bg: 'danger', label: priorityLabel(priority) };
  }
  if (priority === 'low') {
    return { bg: 'secondary', label: priorityLabel(priority) };
  }
  return { bg: 'info', label: priorityLabel(priority) };
}

export function closeReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case 'completed':
      return '完了';
    case 'duplicate':
      return '重複';
    case 'rejected':
      return '却下';
    case 'cannot_reproduce':
      return '再現不可';
    case 'on_hold':
      return '保留';
    default:
      return null;
  }
}

export function waitingBadge(item: RequestItem): BadgeMeta | null {
  if (item.isOverdue) {
    return { bg: 'warning', label: '24時間超', text: 'dark' };
  }
  if (item.waitingOn === 'user') {
    return { bg: 'primary', label: '回答待ち' };
  }
  if (item.waitingOn === 'admin') {
    return { bg: 'danger', label: '管理者確認待ち' };
  }
  if (item.waitingOn === 'openclaw') {
    return { bg: 'secondary', label: '処理中' };
  }
  return null;
}

export function attachmentUrl(attachmentId: number): string {
  return buildApiUrl(`/requests/attachments/${attachmentId}`);
}

export function requestSortRank(item: RequestItem): number {
  if (item.isOverdue) return 0;
  if (item.waitingOn === 'user') return 1;
  if (item.hasUnread) return 2;
  if (item.waitingOn === 'admin') return 3;
  if (item.waitingOn === 'openclaw') return 4;
  return 5;
}

export function matchesQueueFilter(item: RequestItem, filter: RequestQueueFilter): boolean {
  if (filter === 'my_turn') return item.waitingOn === 'user';
  if (filter === 'overdue') return item.isOverdue;
  if (filter === 'unread') return item.hasUnread;
  if (filter === 'openclaw') return item.waitingOn === 'openclaw';
  return true;
}
