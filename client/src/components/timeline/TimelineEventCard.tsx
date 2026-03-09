import { Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import type { TimelineEvent, TimelinePriority, TimelineSource } from '../../types/timeline';
import AppCard from '../ui/AppCard';
import AppMobileDataCard from '../ui/AppMobileDataCard';
import AppResponsiveSwitch from '../ui/AppResponsiveSwitch';

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

const PRIORITY_VARIANT: Record<TimelinePriority, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'secondary',
};

const PRIORITY_LABEL: Record<TimelinePriority, string> = {
  critical: '重要',
  high: '高',
  medium: '中',
  low: '低',
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

interface TimelineEventCardProps {
  event: TimelineEvent;
}

export default function TimelineEventCard({ event }: TimelineEventCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (event.actionPath) {
      navigate(event.actionPath);
    }
  };

  const icon = SOURCE_ICON[event.source] ?? '📌';
  const priorityVariant = PRIORITY_VARIANT[event.priority];
  const priorityLabel = PRIORITY_LABEL[event.priority];
  const relativeTime = getRelativeTime(event.timestamp);

  const priorityBadge = (
    <Badge bg={priorityVariant} data-testid="priority-badge">
      {priorityLabel}
    </Badge>
  );

  const unreadDot = !event.isRead ? (
    <span
      data-testid="unread-dot"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: '#0d6efd',
        marginRight: 4,
        verticalAlign: 'middle',
      }}
    />
  ) : null;

  return (
    <AppResponsiveSwitch
      mobile={
        <AppMobileDataCard
          title={
            <span
              onClick={handleClick}
              style={{ cursor: event.actionPath ? 'pointer' : 'default' }}
              data-testid="card-title"
            >
              {unreadDot}
              <span className={event.isRead ? '' : 'fw-bold'}>{icon} {event.title}</span>
            </span>
          }
          subtitle={<span className="text-muted small">{event.body}</span>}
          badges={priorityBadge}
          fields={[{ label: '時刻', value: <span data-testid="relative-time">{relativeTime}</span> }]}
          className="mb-2"
        />
      }
      desktop={
        <AppCard
          className="mb-2"
          style={{ cursor: event.actionPath ? 'pointer' : 'default' }}
          onClick={handleClick}
          data-testid="desktop-card"
        >
          <AppCard.Body className="py-2">
            <div className="d-flex align-items-center gap-2">
              <span aria-label={`icon-${event.source}`} style={{ fontSize: '1.1em' }}>{icon}</span>
              <div className="flex-grow-1 overflow-hidden">
                <div className="d-flex align-items-center gap-2">
                  {unreadDot}
                  <span
                    className={`text-truncate ${event.isRead ? '' : 'fw-bold'}`}
                    data-testid="card-title"
                  >
                    {event.title}
                  </span>
                </div>
                <div className="text-muted small text-truncate">{event.body}</div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <span className="text-muted small" data-testid="relative-time">{relativeTime}</span>
                {priorityBadge}
              </div>
            </div>
          </AppCard.Body>
        </AppCard>
      }
    />
  );
}
