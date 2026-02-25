import { useState, useEffect } from 'react';
import { Card, Row, Col, Alert, Badge, ListGroup, Spinner } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

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
  deadlineAt?: string | null;
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

interface NextAction {
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

function parseNoticeTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function proposalDeadlineMs(notice: Notice): number | null {
  if (notice.type !== 'inbound_request') return null;
  const directDeadline = parseNoticeTime(notice.deadlineAt ?? null);
  if (directDeadline > 0) return directDeadline;

  const createdAtMs = parseNoticeTime(notice.createdAt);
  if (createdAtMs <= 0) return null;
  return createdAtMs + (PROPOSAL_RESPONSE_DEADLINE_HOURS * 60 * 60 * 1000);
}

function effectiveNoticePriority(notice: Notice, nowMs: number): number {
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

function pickTopUnreadNotice(notifications: NotificationsResponse | null, now: Date): Notice | null {
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

function formatDeadline(deadlineMs: number): string {
  return new Date(deadlineMs).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function noticeVariant(type: Notice['type']): string {
  if (type === 'inbound_request') return 'danger';
  if (type === 'status_update') return 'warning';
  if (type === 'admin_message') return 'info';
  return 'secondary';
}

function buildNextAction(
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
      primaryPath: topUnreadNotice.actionPath || '/',
      secondaryLabel: 'マッチング一覧を確認',
      secondaryPath: '/proposals',
      badge: 'primary',
    };
  }

  if (topUnreadNotice && (topUnreadNotice.type === 'inbound_request' || topUnreadNotice.type === 'status_update')) {
    const primaryPath = topUnreadNotice.actionPath || '/proposals';
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
  const [dashboardError, setDashboardError] = useState('');
  const nextAction = buildNextAction(status, notifications);

  const fetchDashboardData = async () => {
    setLoadingNotifications(true);
    setDashboardError('');
    try {
      const [statusData, noticesData] = await Promise.all([
        api.get<UploadStatus>('/upload/status'),
        api.get<NotificationsResponse>('/notifications'),
      ]);
      setStatus(statusData);
      setNotifications(noticesData);
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : 'ダッシュボード情報の取得に失敗しました');
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
      <h4 className="page-title mb-3">ダッシュボード</h4>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
            <div>
              <div className="mb-2">
                <Badge bg={nextAction.badge}>次にやること</Badge>
              </div>
              <h5 className="mb-1">{nextAction.title}</h5>
              <div className="text-muted small">{nextAction.description}</div>
            </div>
            <div className="d-flex gap-2 mobile-stack">
              <Link to={nextAction.primaryPath} className="btn btn-primary btn-sm">
                {nextAction.primaryLabel}
              </Link>
              <Link to={nextAction.secondaryPath} className="btn btn-outline-secondary btn-sm">
                {nextAction.secondaryLabel}
              </Link>
            </div>
          </div>
        </Card.Body>
      </Card>

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
              <button type="button" className="btn btn-sm btn-outline-warning" onClick={fetchDashboardData}>
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
                  <span className="small text-primary fw-semibold mt-1">
                    {notice.actionLabel} →
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
                <Card.Title className="mb-0">デッドストックリスト</Card.Title>
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
                <Card.Title className="mb-0">医薬品使用量リスト</Card.Title>
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
                  ? 'デッドストックリストの交換先を検索できます'
                  : '医薬品使用量リストのアップロードが必要です'}
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
          マッチング機能を利用するには、当月の医薬品使用量Excelをアップロードしてください。
        </Alert>
      )}
    </div>
  );
}
