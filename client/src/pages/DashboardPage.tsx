import { useState, useEffect } from 'react';
import { Card, Row, Col, Alert, Badge, ListGroup, Spinner } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import DisclaimerBanner from '../components/DisclaimerBanner';

interface UploadStatus {
  deadStockUploaded: boolean;
  usedMedicationUploaded: boolean;
  lastDeadStockUpload: string | null;
  lastUsedMedicationUpload: string | null;
}

interface Notice {
  id: string;
  type: 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message';
  title: string;
  body: string;
  actionPath: string;
  actionLabel: string;
  createdAt: string | null;
  unread: boolean;
  priority: number;
}

interface NotificationSummary {
  unreadMessages: number;
  actionableRequests: number;
  total: number;
}

interface NotificationsResponse {
  notices: Notice[];
  summary: NotificationSummary;
}

function noticeVariant(type: Notice['type']): string {
  if (type === 'inbound_request') return 'danger';
  if (type === 'status_update') return 'warning';
  if (type === 'admin_message') return 'info';
  return 'secondary';
}

function parseMessageId(noticeId: string): number | null {
  if (!noticeId.startsWith('message-')) return null;
  const id = Number(noticeId.replace('message-', ''));
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  const fetchDashboardData = async () => {
    setLoadingNotifications(true);
    try {
      const [statusData, noticesData] = await Promise.all([
        api.get<UploadStatus>('/upload/status'),
        api.get<NotificationsResponse>('/notifications'),
      ]);
      setStatus(statusData);
      setNotifications(noticesData);
    } catch {
      // ignore UI blocking
    } finally {
      setLoadingNotifications(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleNoticeClick = async (notice: Notice) => {
    const messageId = parseMessageId(notice.id);
    if (notice.type === 'admin_message' && notice.unread && messageId) {
      try {
        await api.post(`/notifications/messages/${messageId}/read`);
      } catch {
        // ignore
      }
    }

    if (notice.actionPath) {
      navigate(notice.actionPath);
      return;
    }

    fetchDashboardData();
  };

  return (
    <div>
      <DisclaimerBanner />
      <h4 className="page-title mb-3">ダッシュボード</h4>

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
                  onClick={() => handleNoticeClick(notice)}
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
                  <span className="btn btn-outline-primary btn-sm mt-1" aria-hidden="true">
                    {notice.actionLabel}
                  </span>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <p>ようこそ、{user?.name} さん</p>

      <Row className="g-3">
        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <Card.Title className="mb-0">不動在庫</Card.Title>
                {status?.lastDeadStockUpload && (
                  <small className="text-muted">最終: {new Date(status.lastDeadStockUpload).toLocaleDateString('ja-JP')}</small>
                )}
              </div>
              <Card.Text className="mt-2">
                {status?.deadStockUploaded
                  ? <Badge bg="success">アップロード済み</Badge>
                  : <Badge bg="secondary">未アップロード</Badge>}
              </Card.Text>
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              {' '}
              <Link to="/inventory/dead-stock" className="btn btn-outline-secondary btn-sm">一覧を見る</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <Card.Title className="mb-0">使用薬剤</Card.Title>
                {status?.lastUsedMedicationUpload && (
                  <small className="text-muted">最終: {new Date(status.lastUsedMedicationUpload).toLocaleDateString('ja-JP')}</small>
                )}
              </div>
              <Card.Text className="mt-2">
                {status?.usedMedicationUploaded
                  ? <Badge bg="success">当月アップロード済み</Badge>
                  : <Badge bg="warning" text="dark">当月未アップロード</Badge>}
              </Card.Text>
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              {' '}
              <Link to="/inventory/used-medication" className="btn btn-outline-secondary btn-sm">一覧を見る</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>マッチング</Card.Title>
              <Card.Text>
                {status?.usedMedicationUploaded
                  ? '不動在庫の交換先を検索できます'
                  : '使用薬剤のアップロードが必要です'}
              </Card.Text>
              <Link
                to="/matching"
                className={`btn btn-sm ${status?.usedMedicationUploaded ? 'btn-primary' : 'btn-secondary disabled'}`}
              >
                マッチングを実行
              </Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>在庫参照</Card.Title>
              <Card.Text>全薬局の医薬品在庫を検索・閲覧</Card.Text>
              <Link to="/inventory/browse" className="btn btn-outline-primary btn-sm">在庫を検索</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>マッチング状況</Card.Title>
              <Card.Text>仮マッチング・確定済みの一覧を確認</Card.Text>
              <Link to="/proposals" className="btn btn-outline-primary btn-sm">マッチング一覧</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>交換履歴</Card.Title>
              <Card.Text>過去の交換記録を確認</Card.Text>
              <Link to="/exchange-history" className="btn btn-outline-primary btn-sm">履歴を見る</Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {!status?.usedMedicationUploaded && (
        <Alert variant="info" className="mt-3">
          マッチング機能を利用するには、当月の使用薬剤Excelをアップロードしてください。
        </Alert>
      )}
    </div>
  );
}
