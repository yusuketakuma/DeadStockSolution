import { sanitizeInternalPath } from '../../utils/navigation';

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

export interface NotificationSummary {
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

const PROPOSAL_RESPONSE_DEADLINE_HOURS = 72;
const PROPOSAL_DEADLINE_ALERT_HOURS = 24;

export function parseNoticeTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function proposalDeadlineMs(notice: Notice): number | null {
  if (notice.type !== 'inbound_request') return null;
  const directDeadline = parseNoticeTime(notice.deadlineAt ?? null);
  if (directDeadline > 0) return directDeadline;

  const createdAtMs = parseNoticeTime(notice.createdAt);
  if (createdAtMs <= 0) return null;
  return createdAtMs + (PROPOSAL_RESPONSE_DEADLINE_HOURS * 60 * 60 * 1000);
}

export function effectiveNoticePriority(notice: Notice, nowMs: number): number {
  const basePriority = notice.priority > 0 ? notice.priority : 5;
  const deadlineMs = proposalDeadlineMs(notice);
  if (deadlineMs === null) return basePriority;

  const remainingMs = deadlineMs - nowMs;
  if (remainingMs <= 0) return 0;
  if (remainingMs <= PROPOSAL_DEADLINE_ALERT_HOURS * 60 * 60 * 1000) {
    return Math.max(1, basePriority - 1);
  }
  return basePriority;
}

export function pickTopUnreadNotice(notifications: NotificationsResponse | null, now: Date): Notice | null {
  const unreadNotices = notifications?.notices.filter((notice) => notice.unread) ?? [];
  if (unreadNotices.length === 0) return null;

  const nowMs = now.getTime();
  const sorted = [...unreadNotices].sort((a, b) => {
    const aPriority = effectiveNoticePriority(a, nowMs);
    const bPriority = effectiveNoticePriority(b, nowMs);
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aDeadline = proposalDeadlineMs(a);
    const bDeadline = proposalDeadlineMs(b);
    if (aDeadline !== null || bDeadline !== null) {
      if (aDeadline === null) return 1;
      if (bDeadline === null) return -1;
      if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    }

    const aCreated = parseNoticeTime(a.createdAt);
    const bCreated = parseNoticeTime(b.createdAt);
    return bCreated - aCreated;
  });

  return sorted[0] ?? null;
}

export function formatDeadline(deadlineMs: number): string {
  return new Date(deadlineMs).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

export function buildNextAction(
  status: UploadStatus | null,
  notifications: NotificationsResponse | null,
  now: Date = new Date(),
): NextAction {
  if (!status?.deadStockUploaded) {
    return {
      title: 'デッドストックリストをアップロード',
      description: 'まずは交換候補の母集団になるデッドストックデータを登録してください。',
      primaryLabel: 'アップロードへ進む',
      primaryPath: '/upload',
      secondaryLabel: 'デッドストックリストへ',
      secondaryPath: '/inventory/dead-stock',
      badge: 'warning',
    };
  }

  if (!status.usedMedicationUploaded) {
    return {
      title: '医薬品使用量リストをアップロード',
      description: '当月の医薬品使用量が未登録です。登録後にマッチングを実行できます。',
      primaryLabel: 'アップロードへ進む',
      primaryPath: '/upload',
      secondaryLabel: '医薬品使用量リストへ',
      secondaryPath: '/inventory/used-medication',
      badge: 'warning',
    };
  }

  const topUnreadNotice = pickTopUnreadNotice(notifications, now);
  if (topUnreadNotice?.type === 'admin_message') {
    return {
      title: '優先度の高い未読メッセージを確認',
      description: '管理者から未読メッセージがあります。優先度の高い内容から確認してください。',
      primaryLabel: topUnreadNotice.actionLabel || '内容を確認',
      primaryPath: sanitizeInternalPath(topUnreadNotice.actionPath, '/'),
      secondaryLabel: 'マッチング一覧を確認',
      secondaryPath: '/proposals',
      badge: 'primary',
    };
  }

  if (topUnreadNotice && (topUnreadNotice.type === 'inbound_request' || topUnreadNotice.type === 'status_update')) {
    const primaryPath = sanitizeInternalPath(topUnreadNotice.actionPath, '/proposals');
    const primaryLabel = topUnreadNotice.actionLabel || 'マッチング一覧を確認';
    const deadlineMs = proposalDeadlineMs(topUnreadNotice);
    if (deadlineMs !== null) {
      const remainingMs = deadlineMs - now.getTime();
      if (remainingMs <= 0) {
        return {
          title: '承認期限を過ぎた提案に対応',
          description: `承認期限（${formatDeadline(deadlineMs)}）を超過した提案があります。至急ご確認ください。`,
          primaryLabel,
          primaryPath,
          secondaryLabel: 'マッチング一覧を確認',
          secondaryPath: '/proposals',
          badge: 'warning',
        };
      }
      if (remainingMs <= PROPOSAL_DEADLINE_ALERT_HOURS * 60 * 60 * 1000) {
        return {
          title: '承認期限が近い提案に対応',
          description: `承認期限（${formatDeadline(deadlineMs)}）が近い提案があります。先に確認してください。`,
          primaryLabel,
          primaryPath,
          secondaryLabel: '交換履歴を見る',
          secondaryPath: '/exchange-history',
          badge: 'warning',
        };
      }
    }

    return {
      title: '届いている提案に対応',
      description: '承認待ちの提案があります。先に確認すると交換確定までが早くなります。',
      primaryLabel,
      primaryPath,
      secondaryLabel: '交換履歴を見る',
      secondaryPath: '/exchange-history',
      badge: 'primary',
    };
  }

  if (topUnreadNotice?.type === 'new_comment') {
    return {
      title: '新しいコメントを確認',
      description: '提案にコメントが追加されました。確認してください。',
      primaryLabel: topUnreadNotice.actionLabel || 'コメントを確認',
      primaryPath: sanitizeInternalPath(topUnreadNotice.actionPath, '/proposals'),
      secondaryLabel: 'マッチング一覧を確認',
      secondaryPath: '/proposals',
      badge: 'primary',
    };
  }

  if (topUnreadNotice?.type === 'match_update') {
    return {
      title: '交換候補の更新を確認',
      description: '他薬局の更新により候補が変化しています。最新候補を確認してください。',
      primaryLabel: topUnreadNotice.actionLabel || '候補を確認',
      primaryPath: sanitizeInternalPath(topUnreadNotice.actionPath, '/matching'),
      secondaryLabel: 'マッチング一覧を確認',
      secondaryPath: '/proposals',
      badge: 'primary',
    };
  }

  if ((notifications?.summary.actionableRequests ?? 0) > 0) {
    return {
      title: '届いている提案に対応',
      description: '承認待ちの提案があります。先に確認すると交換確定までが早くなります。',
      primaryLabel: 'マッチング一覧を確認',
      primaryPath: '/proposals',
      secondaryLabel: '交換履歴を見る',
      secondaryPath: '/exchange-history',
      badge: 'primary',
    };
  }

  return {
    title: 'マッチングを実行',
    description: '最新データで交換候補を探し、仮マッチング提案を開始してください。',
    primaryLabel: 'マッチングへ進む',
    primaryPath: '/matching',
    secondaryLabel: '在庫参照を開く',
    secondaryPath: '/inventory/browse',
    badge: 'success',
  };
}

export function parseMessageId(noticeId: string): number | null {
  if (!noticeId.startsWith('message-')) return null;
  const id = Number(noticeId.replace('message-', ''));
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function parseMatchNotificationId(noticeId: string): number | null {
  if (!noticeId.startsWith('match-')) return null;
  const id = Number(noticeId.replace('match-', ''));
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function parseNotificationId(noticeId: string): number | null {
  if (!noticeId.startsWith('notification-')) return null;
  const id = Number(noticeId.replace('notification-', ''));
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function resolveNoticeReadEndpoint(notice: Notice): string | null {
  if (!notice.unread) return null;

  if (notice.type === 'admin_message') {
    const messageId = parseMessageId(notice.id);
    return messageId ? `/notifications/messages/${messageId}/read` : null;
  }

  if (notice.type === 'match_update') {
    const matchId = parseMatchNotificationId(notice.id);
    return matchId ? `/notifications/matches/${matchId}/read` : null;
  }

  if (
    notice.type === 'inbound_request'
    || notice.type === 'outbound_request'
    || notice.type === 'status_update'
    || notice.type === 'new_comment'
  ) {
    const notifId = parseNotificationId(notice.id);
    return notifId ? `/notifications/${notifId}/read` : null;
  }

  return null;
}
