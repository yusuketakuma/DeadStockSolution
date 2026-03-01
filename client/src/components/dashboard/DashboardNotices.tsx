import { Badge, ListGroup } from 'react-bootstrap';
import AppAlert from '../ui/AppAlert';
import AppButton from '../ui/AppButton';
import AppCard from '../ui/AppCard';
import InlineLoader from '../ui/InlineLoader';
import { Notice, NotificationsResponse, noticeTypeLabel, noticeVariant } from './types';
import { formatDateTimeJa } from '../../utils/formatters';

interface Props {
  notifications: NotificationsResponse | null;
  loadingNotifications: boolean;
  dashboardError: string;
  onNoticeClick: (notice: Notice) => void;
  onRetry: () => void;
  onRefresh: () => void;
}

export default function DashboardNotices({
  notifications,
  loadingNotifications,
  dashboardError,
  onNoticeClick,
  onRetry,
  onRefresh,
}: Props) {
  return (
    <AppCard className="mb-3">
      <AppCard.Header className="d-flex justify-content-between align-items-center">
        <span>お知らせ</span>
        <div className="d-flex gap-2 flex-wrap align-items-center">
          {notifications && (
            <>
              <Badge bg="danger">対応要: {notifications.summary.actionableRequests}</Badge>
              <Badge bg="info">未読メッセージ: {notifications.summary.unreadMessages}</Badge>
            </>
          )}
          <AppButton size="sm" variant="outline-secondary" onClick={onRefresh} disabled={loadingNotifications}>
            更新
          </AppButton>
        </div>
      </AppCard.Header>
      <AppCard.Body>
        {dashboardError && (
          <AppAlert variant="warning" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
            <span className="small">{dashboardError}</span>
            <AppButton size="sm" variant="outline-warning" onClick={onRetry} disabled={loadingNotifications}>
              再試行
            </AppButton>
          </AppAlert>
        )}

        {loadingNotifications && (
          <InlineLoader text="通知を読み込み中..." className="text-muted small" />
        )}

        {!loadingNotifications && !dashboardError && (!notifications || notifications.notices.length === 0) && (
          <div className="text-muted small">現在のお知らせはありません。</div>
        )}

        {!loadingNotifications && notifications && notifications.notices.length > 0 && (
          <ListGroup variant="flush">
            {notifications.notices.map((notice) => (
              <ListGroup.Item
                key={notice.id}
                action
                onClick={() => onNoticeClick(notice)}
                className="d-flex justify-content-between align-items-start gap-2"
              >
                <div>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <Badge bg={noticeVariant(notice.type)}>
                      {noticeTypeLabel(notice.type)}
                    </Badge>
                    {notice.unread && <Badge bg="warning" text="dark">未読</Badge>}
                  </div>
                  <div className="fw-semibold">{notice.title}</div>
                  <div className="small text-muted">{notice.body}</div>
                  {notice.createdAt && (
                    <div className="small text-muted mt-1">
                      {formatDateTimeJa(notice.createdAt)}
                    </div>
                  )}
                </div>
                <span className="small text-primary fw-semibold mt-1">
                  {notice.actionLabel} →
                </span>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
