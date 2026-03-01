import { Badge, ListGroup } from 'react-bootstrap';
import type { TimelineEvent, TimelinePriority, TimelineSource } from '../../types/timeline';

// ソースラベルのマッピング
const SOURCE_LABELS: Record<TimelineSource, string> = {
  proposal: '提案',
  comment: 'コメント',
  match: '候補',
  upload: 'アップロード',
  admin_message: '管理者',
  exchange_history: '履歴',
  expiry_risk: '期限',
  notification: '通知',
  feedback: '評価',
  activity: '操作',
};

// 優先度バリアントのマッピング
const PRIORITY_VARIANTS: Record<TimelinePriority, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'secondary',
};

/**
 * 相対時間を日本語で返す
 * 例: 「たった今」「5分前」「2時間前」「昨日」「3日前」
 */
export function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return timestamp;

  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSec < 60) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays === 1) return '昨日';
  return `${diffDays}日前`;
}

interface TimelineEventCardProps {
  event: TimelineEvent;
  onClick?: (event: TimelineEvent) => void;
}

export default function TimelineEventCard({ event, onClick }: TimelineEventCardProps) {
  const sourceLabel = SOURCE_LABELS[event.source];
  const priorityVariant = PRIORITY_VARIANTS[event.priority];
  const isUnread = !event.isRead;

  const handleClick = () => {
    if (onClick) {
      onClick(event);
    }
  };

  return (
    <ListGroup.Item
      action={!!onClick}
      onClick={handleClick}
      className={[
        'd-flex',
        'justify-content-between',
        'align-items-start',
        'gap-2',
        'py-2',
        isUnread ? 'unread bg-light border-start border-primary border-3' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex-grow-1 min-w-0">
        {/* バッジ行 */}
        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
          <Badge bg="secondary" className="fw-normal">
            {sourceLabel}
          </Badge>
          <Badge bg={priorityVariant} text={priorityVariant === 'warning' ? 'dark' : undefined}>
            {event.priority}
          </Badge>
        </div>

        {/* タイトル */}
        <div className="fw-semibold text-truncate">{event.title}</div>

        {/* 本文（2行まで）*/}
        <div
          className="small text-muted"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {event.body}
        </div>

        {/* 相対時間 */}
        <div className="small text-muted mt-1">{formatRelativeTime(event.timestamp)}</div>
      </div>
    </ListGroup.Item>
  );
}
