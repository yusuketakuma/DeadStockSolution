import { Badge, ListGroup, OverlayTrigger, Popover } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppButton from '../ui/AppButton';
import type { TimelineEvent, TimelinePriority, TimelineSource } from '../../types/timeline';
import { sanitizeInternalPath } from '../../utils/navigation';

const MAX_DROPDOWN_ITEMS = 8;

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

function getRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'たった今';
  if (diffMins < 60) return `${diffMins}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return `${diffDays}日前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface NotificationDropdownProps {
  events: TimelineEvent[];
  unreadCount: number;
  show: boolean;
  onToggle: (nextOpen: boolean) => void;
  onMarkViewed: () => void;
}

export default function NotificationDropdown({
  events,
  unreadCount,
  show,
  onToggle,
  onMarkViewed,
}: NotificationDropdownProps) {
  const displayEvents = events.slice(0, MAX_DROPDOWN_ITEMS);

  const handleItemClick = () => {
    onToggle(false);
  };

  return (
    <OverlayTrigger
      trigger="click"
      placement="bottom-end"
      rootClose
      show={show}
      onToggle={onToggle}
      overlay={
        <Popover id="notification-dropdown-popover" className="notification-dropdown-popover">
          <Popover.Header as="div" className="d-flex align-items-center justify-content-between">
            <span className="fw-semibold">通知</span>
            <div className="d-flex align-items-center gap-2">
              {unreadCount > 0 && (
                <AppButton
                  type="button"
                  variant="link"
                  size="sm"
                  className="p-0 text-decoration-none small"
                  onClick={onMarkViewed}
                >
                  すべて既読
                </AppButton>
              )}
            </div>
          </Popover.Header>
          <Popover.Body className="p-0">
            {displayEvents.length === 0 ? (
              <div className="text-muted small px-3 py-3 text-center">
                通知はありません
              </div>
            ) : (
              <ListGroup variant="flush" className="notification-dropdown-list">
                {displayEvents.map((event) => {
                  const icon = SOURCE_ICON[event.source] ?? '📌';
                  const linkTo = sanitizeInternalPath(event.actionPath, '/');
                  const actionHint = linkTo === '/' ? 'ダッシュボードへ →' : '詳細を見る →';

                  return (
                    <ListGroup.Item
                      key={event.id}
                      as={Link}
                      to={linkTo}
                      onClick={handleItemClick}
                      className={`notification-dropdown-item${event.isRead ? '' : ' is-unread'}`}
                      action
                    >
                      <div className="d-flex gap-2 align-items-start">
                        <span className="notification-dropdown-icon" aria-hidden="true">{icon}</span>
                        <div className="notification-dropdown-content min-w-0 flex-grow-1">
                          <div className="d-flex align-items-center gap-1 mb-0">
                            {!event.isRead && <span className="notification-dropdown-unread-dot" />}
                            <span className="notification-dropdown-title text-truncate">
                              {event.title}
                            </span>
                            <Badge
                              bg={PRIORITY_VARIANT[event.priority]}
                              className="notification-dropdown-priority ms-auto flex-shrink-0"
                            >
                              {event.priority === 'critical' ? '緊急' : event.priority === 'high' ? '重要' : ''}
                            </Badge>
                          </div>
                          <div className="notification-dropdown-body text-truncate">{event.body}</div>
                          <div className="d-flex align-items-center justify-content-between mt-1">
                            <span className="notification-dropdown-time">{getRelativeTime(event.timestamp)}</span>
                            <span className="notification-dropdown-action-hint">
                              {actionHint}
                            </span>
                          </div>
                        </div>
                      </div>
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>
            )}
            <div className="notification-dropdown-footer">
              <Link
                to="/notifications"
                className="btn btn-link btn-sm w-100 text-decoration-none"
                onClick={handleItemClick}
              >
                すべての通知を見る
              </Link>
            </div>
          </Popover.Body>
        </Popover>
      }
    >
      <AppButton
        type="button"
        variant="link"
        className="notification-dropdown-trigger"
        aria-label={show
          ? '通知ドロップダウンを閉じる'
          : unreadCount > 0
            ? `${unreadCount}件の未読通知を開く`
            : '通知ドロップダウンを開く'}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <Badge
            bg="danger"
            pill
            className="notification-dropdown-badge"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </AppButton>
    </OverlayTrigger>
  );
}
