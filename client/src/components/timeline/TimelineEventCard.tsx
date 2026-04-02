import type { KeyboardEvent } from 'react';
import { Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import type { TimelineEvent, TimelinePriority, TimelineSource } from '../../types/timeline';
import { sanitizeInternalPath } from '../../utils/navigation';

const SOURCE_ICON: Record<TimelineSource, string> = {
  proposal: '↔️',
  comment: '💬',
  match: '🔍',
  upload: '📦',
  admin_message: '📢',
  exchange_history: '✅',
  expiry_risk: '⚠️',
  notification: '🔔',
  activity: '📋',
  feedback: '⭐',
};

const SOURCE_LABEL: Record<TimelineSource, string> = {
  proposal: '提案',
  comment: 'コメント',
  match: 'マッチ',
  upload: '取込',
  admin_message: '運営',
  exchange_history: '履歴',
  expiry_risk: '期限',
  notification: '通知',
  activity: '操作',
  feedback: '評価',
};

const PRIORITY_VARIANT: Record<TimelinePriority, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'secondary',
};

const PRIORITY_LABEL: Record<TimelinePriority, string> = {
  critical: '緊急',
  high: '重要',
  medium: '通常',
  low: '補足',
};

function getRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return `${diffDays}日前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getAbsoluteTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TimelineEventCardProps {
  event: TimelineEvent;
}

export default function TimelineEventCard({ event }: TimelineEventCardProps) {
  const navigate = useNavigate();
  const actionPath = sanitizeInternalPath(event.actionPath, '');
  const isClickable = Boolean(actionPath);

  const handleClick = () => {
    if (actionPath) {
      navigate(actionPath);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const icon = SOURCE_ICON[event.source] ?? '📌';
  const sourceLabel = SOURCE_LABEL[event.source] ?? '更新';
  const priorityVariant = PRIORITY_VARIANT[event.priority];
  const priorityLabel = PRIORITY_LABEL[event.priority];
  const relativeTime = getRelativeTime(event.timestamp);
  const absoluteTime = getAbsoluteTime(event.timestamp);

  const priorityBadge = (
    <Badge bg={priorityVariant} data-testid="priority-badge" className="rounded-pill">
      {priorityLabel}
    </Badge>
  );

  const unreadDot = !event.isRead ? (
    <span data-testid="unread-dot" className="dl-timeline-unread-dot" />
  ) : null;

  return (
    <div className="dl-timeline-event">
      <div className={`dl-timeline-marker ${event.isRead ? 'is-read' : 'is-unread'}`} aria-hidden="true">
        <span className="dl-timeline-marker-dot">{icon}</span>
      </div>
      <div
        className={`dl-timeline-card${isClickable ? ' is-clickable' : ''}${event.isRead ? '' : ' is-unread'}`}
        onClick={isClickable ? handleClick : undefined}
        onKeyDown={handleKeyDown}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        data-testid="desktop-card"
      >
        <div className="dl-timeline-card-top">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="dl-timeline-source-chip" aria-label={`icon-${event.source}`}>
              <span aria-hidden="true">{icon}</span>
              <span>{sourceLabel}</span>
            </span>
            {priorityBadge}
            {!event.isRead && <span className="dl-timeline-unread-pill">未読</span>}
          </div>
          <span className="dl-timeline-time" data-testid="relative-time" title={absoluteTime}>
            {relativeTime}
          </span>
        </div>

        <div className="dl-timeline-title-row">
          {unreadDot}
          <span className={`dl-timeline-title ${event.isRead ? '' : 'fw-semibold'}`} data-testid="card-title">
            {event.title}
          </span>
        </div>

        <p className="dl-timeline-body mb-0">{event.body}</p>

        <div className="dl-timeline-meta">
          <span className="text-muted">{absoluteTime}</span>
          {actionPath && <span className="dl-timeline-action-hint">詳細を開く</span>}
        </div>
      </div>
    </div>
  );
}
