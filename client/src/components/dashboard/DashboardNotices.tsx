import { Card, Alert, Badge, ListGroup, Spinner } from 'react-bootstrap';
import { Notice, NotificationsResponse, noticeVariant } from './types';

interface Props {
  notifications: NotificationsResponse | null;
  loadingNotifications: boolean;
  dashboardError: string;
  onNoticeClick: (notice: Notice) => void;
  onRetry: () => void;
}

export default function DashboardNotices({
  notifications,
  loadingNotifications,
  dashboardError,
  onNoticeClick,
  onRetry,
}: Props) {
  return (
    <Card className="mb-3">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>お知らせ</span>
        {notifications && (
          <div className="d-flex gap-2 flex-wrap">
            <Badge bg="danger">対応要: {notifications.summary.actionableRequests}</Badge>
            <Badge bg="info">未読メッセージ: {notifications.summary.unreadMessages}</Badge>
          </div>
        )}
      </Card.Header>
      <Card.Body>
        {dashboardError && (
          <Alert variant="warning" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
            <span className="small">{dashboardError}</span>
            <button type="button" className="btn btn-sm btn-outline-warning" onClick={onRetry}>
              再試行
            </button>
          </Alert>
        )}

        {loadingNotifications && (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner size="sm" />
            通知を読み込み中...
          </div>
        )}

        {!loadingNotifications && (!notifications || notifications.notices.length === 0) && (
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
                      {notice.type === 'admin_message' ? '管理者メッセージ' : '交換通知'}
                    </Badge>
                    {notice.unread && <Badge bg="warning" text="dark">未読</Badge>}
                  </div>
                  <div className="fw-semibold">{notice.title}</div>
                  <div className="small text-muted">{notice.body}</div>
                  {notice.createdAt && (
                    <div className="small text-muted mt-1">
                      {new Date(notice.createdAt).toLocaleString('ja-JP')}
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
      </Card.Body>
    </Card>
  );
}
