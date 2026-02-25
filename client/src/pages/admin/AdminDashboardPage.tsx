import { useState, useEffect, FormEvent } from 'react';
import { Card, Row, Col, Form, Button, Alert, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

interface Stats {
  totalPharmacies: number;
  activePharmacies: number;
  inactivePharmacies: number;
  totalUploads: number;
  totalProposals: number;
  totalExchanges: number;
  totalPickupItems: number;
  totalExchangeValue: number;
}

interface Observability {
  windowMinutes: number;
  totalRequests: number;
  totalErrors5xx: number;
  errorRate5xx: number;
  authFailures401: number;
  forbidden403: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  topSlowPaths: Array<{
    path: string;
    count: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
}

interface PharmacyOption {
  id: number;
  name: string;
  isActive: boolean;
}

interface AdminMessage {
  id: number;
  targetType: 'all' | 'pharmacy';
  targetPharmacyId: number | null;
  title: string;
  body: string;
  actionPath: string | null;
  createdAt: string | null;
}

interface MessagesResponse {
  data: AdminMessage[];
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [pharmacies, setPharmacies] = useState<PharmacyOption[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [targetType, setTargetType] = useState<'all' | 'pharmacy'>('all');
  const [targetPharmacyId, setTargetPharmacyId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionPath, setActionPath] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchData = async () => {
    const [statsResult, observabilityResult, pharmacyResult, messagesResult] = await Promise.allSettled([
      api.get<Stats>('/admin/stats'),
      api.get<Observability>('/admin/observability?minutes=60'),
      api.get<{ data: PharmacyOption[] }>('/admin/pharmacies/options'),
      api.get<MessagesResponse>('/admin/messages?page=1&limit=10'),
    ]);

    if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    if (observabilityResult.status === 'fulfilled') setObservability(observabilityResult.value);
    if (pharmacyResult.status === 'fulfilled') setPharmacies(pharmacyResult.value.data);
    if (messagesResult.status === 'fulfilled') setMessages(messagesResult.value.data);

    const failures = [statsResult, observabilityResult, pharmacyResult, messagesResult]
      .filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      setError('一部のデータの取得に失敗しました');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    setMessage('');
    try {
      await api.post('/admin/messages', {
        targetType,
        targetPharmacyId: targetType === 'pharmacy' ? Number(targetPharmacyId) : null,
        title,
        body,
        actionPath: actionPath || null,
      });
      setMessage('加盟薬局へメッセージを送信しました');
      setTitle('');
      setBody('');
      setActionPath('');
      if (targetType === 'pharmacy') {
        setTargetPharmacyId('');
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'メッセージ送信に失敗しました');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h4 className="page-title mb-3">管理者ダッシュボード</h4>

      <Card className="mb-3">
        <Card.Header>運用クイック導線</Card.Header>
        <Card.Body className="d-flex gap-2 flex-wrap mobile-stack">
          <Link to="/admin/openclaw" className="btn btn-sm btn-primary">OpenClaw連携を確認</Link>
          <Link to="/admin/drug-master" className="btn btn-sm btn-outline-primary">医薬品マスター管理</Link>
          <Link to="/admin/pharmacies" className="btn btn-sm btn-outline-secondary">加盟薬局管理</Link>
          <Link to="/admin/logs" className="btn btn-sm btn-outline-secondary">操作ログを見る</Link>
        </Card.Body>
      </Card>

      <Row className="g-3 mb-3">
        <Col md={4} xl={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalPharmacies ?? '-'}</Card.Title>
              <Card.Text>登録薬局数</Card.Text>
              <div className="small text-muted">
                有効: {stats?.activePharmacies ?? '-'} / 無効: {stats?.inactivePharmacies ?? '-'}
              </div>
              <Link to="/admin/pharmacies" className="btn btn-sm btn-outline-primary mt-2">登録薬局情報を見る</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalPickupItems ?? '-'}</Card.Title>
              <Card.Text>引き取り数（明細件数）</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{(stats?.totalExchangeValue ?? 0).toLocaleString()}</Card.Title>
              <Card.Text>交換金額（累計）</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalExchanges ?? '-'}</Card.Title>
              <Card.Text>交換履歴件数</Card.Text>
              <Link to="/admin/exchanges" className="btn btn-sm btn-outline-primary mt-2">交換履歴を見る</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalUploads ?? '-'}</Card.Title>
              <Card.Text>アップロード件数</Card.Text>
              <Link to="/admin/logs" className="btn btn-sm btn-outline-secondary mt-2">操作ログを見る</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="h5">マスター</Card.Title>
              <Card.Text>医薬品マスター</Card.Text>
              <Link to="/admin/drug-master" className="btn btn-sm btn-outline-primary mt-2">マスター管理</Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{observability?.totalRequests ?? '-'}</Card.Title>
              <Card.Text>60分リクエスト数</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{observability?.p95LatencyMs ?? '-'}</Card.Title>
              <Card.Text>p95応答時間 (ms)</Card.Text>
              <div className="small text-muted">平均: {observability?.avgLatencyMs ?? '-'} ms</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{observability?.errorRate5xx ?? '-'}</Card.Title>
              <Card.Text>5xxエラー率 (%)</Card.Text>
              <div className="small text-muted">件数: {observability?.totalErrors5xx ?? '-'}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">
                {observability ? `${observability.authFailures401}/${observability.forbidden403}` : '-'}
              </Card.Title>
              <Card.Text>401/403 件数</Card.Text>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {message && <Alert variant="success" onClose={() => setMessage('')} dismissible>{message}</Alert>}
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      <Card className="mb-3">
        <Card.Header>遅延上位エンドポイント（過去60分）</Card.Header>
        <Card.Body>
          {!observability || observability.topSlowPaths.length === 0 ? (
            <div className="text-muted small">監視データがありません。</div>
          ) : (
            <div className="table-responsive">
              <Table striped size="sm" className="mb-0">
                <thead>
                  <tr>
                    <th>エンドポイント</th>
                    <th>件数</th>
                    <th>平均 (ms)</th>
                    <th>p95 (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {observability.topSlowPaths.map((item) => (
                    <tr key={item.path}>
                      <td className="small">{item.path}</td>
                      <td>{item.count}</td>
                      <td>{item.avgLatencyMs}</td>
                      <td>{item.p95LatencyMs}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <Row className="g-3">
        <Col lg={5}>
          <Card>
            <Card.Header>加盟薬局へのメッセージ送信</Card.Header>
            <Card.Body>
              <Form onSubmit={handleSend}>
                <Form.Group className="mb-2">
                  <Form.Label>送信対象</Form.Label>
                  <Form.Select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value as 'all' | 'pharmacy')}
                  >
                    <option value="all">全加盟薬局</option>
                    <option value="pharmacy">特定薬局</option>
                  </Form.Select>
                </Form.Group>

                {targetType === 'pharmacy' && (
                  <Form.Group className="mb-2">
                    <Form.Label>送信先薬局</Form.Label>
                    <Form.Select
                      value={targetPharmacyId}
                      onChange={(e) => setTargetPharmacyId(e.target.value)}
                      required
                    >
                      <option value="">選択してください</option>
                      {pharmacies.filter((pharmacy) => pharmacy.isActive).map((pharmacy) => (
                        <option key={pharmacy.id} value={pharmacy.id}>
                          {pharmacy.name} (ID: {pharmacy.id})
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                )}

                <Form.Group className="mb-2">
                  <Form.Label>タイトル</Form.Label>
                  <Form.Control
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-2">
                  <Form.Label>本文</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={2000}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>通知クリック時の遷移先（任意）</Form.Label>
                  <Form.Control
                    placeholder="/proposals など"
                    value={actionPath}
                    onChange={(e) => setActionPath(e.target.value)}
                  />
                  <Form.Text className="text-muted">先頭は / で入力してください。</Form.Text>
                </Form.Group>

                <Button type="submit" disabled={sending}>
                  {sending ? '送信中...' : '送信'}
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={7}>
          <Card>
            <Card.Header>送信済みメッセージ（最新10件）</Card.Header>
            <Card.Body>
              {messages.length === 0 ? (
                <div className="text-muted small">送信済みメッセージはありません。</div>
              ) : (
                <div className="table-responsive">
                  <Table striped size="sm" className="mobile-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>対象</th>
                        <th>タイトル</th>
                        <th>遷移先</th>
                        <th>送信日時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {messages.map((item) => (
                        <tr key={item.id}>
                          <td>{item.id}</td>
                          <td>{item.targetType === 'all' ? '全体' : `薬局ID:${item.targetPharmacyId}`}</td>
                          <td>{item.title}</td>
                          <td>{item.actionPath || '-'}</td>
                          <td>{item.createdAt ? new Date(item.createdAt).toLocaleString('ja-JP') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

    </div>
  );
}
