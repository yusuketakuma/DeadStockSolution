import { useState, useEffect, FormEvent } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import { Row, Col, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import AppSelect from '../../components/ui/AppSelect';
import LoadingButton from '../../components/ui/LoadingButton';
import AppField from '../../components/ui/AppField';
import AppDataPanel from '../../components/ui/AppDataPanel';
import AppKpiCard from '../../components/ui/AppKpiCard';
import InlineLoader from '../../components/ui/InlineLoader';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';

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

interface RiskOverview {
  totalPharmacies: number;
  highRiskPharmacies: number;
  mediumRiskPharmacies: number;
  lowRiskPharmacies: number;
  avgRiskScore: number;
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
  const [riskOverview, setRiskOverview] = useState<RiskOverview | null>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [pharmacies, setPharmacies] = useState<PharmacyOption[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [targetType, setTargetType] = useState<'all' | 'pharmacy'>('all');
  const [targetPharmacyId, setTargetPharmacyId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionPath, setActionPath] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    const [statsResult, riskResult, observabilityResult, pharmacyResult, messagesResult] = await Promise.allSettled([
      api.get<Stats>('/admin/stats'),
      api.get<RiskOverview>('/admin/risk/overview'),
      api.get<Observability>('/admin/observability?minutes=60'),
      api.get<{ data: PharmacyOption[] }>('/admin/pharmacies/options'),
      api.get<MessagesResponse>('/admin/messages?page=1&limit=10'),
    ]);

    if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    if (riskResult.status === 'fulfilled') setRiskOverview(riskResult.value);
    if (observabilityResult.status === 'fulfilled') setObservability(observabilityResult.value);
    if (pharmacyResult.status === 'fulfilled') setPharmacies(pharmacyResult.value.data);
    if (messagesResult.status === 'fulfilled') setMessages(messagesResult.value.data);

    const failures = [statsResult, riskResult, observabilityResult, pharmacyResult, messagesResult]
      .filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      setError('一部のデータの取得に失敗しました');
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchData();
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
      {loading && !stats && (
        <InlineLoader text="管理データを読み込み中..." className="text-muted small mb-3" />
      )}

      <AppDataPanel title="運用クイック導線" className="mb-3" bodyClassName="d-flex gap-2 flex-wrap mobile-stack">
          <Link to="/admin/openclaw" className="btn btn-sm btn-primary">OpenClaw連携を確認</Link>
          <Link to="/admin/risk" className="btn btn-sm btn-outline-danger">期限リスク分析</Link>
          <Link to="/admin/reports" className="btn btn-sm btn-outline-success">月次レポート</Link>
          <Link to="/admin/drug-master" className="btn btn-sm btn-outline-primary">医薬品マスター管理</Link>
          <Link to="/admin/pharmacies" className="btn btn-sm btn-outline-secondary">加盟薬局管理</Link>
          <Link to="/admin/logs" className="btn btn-sm btn-outline-secondary">操作ログを見る</Link>
      </AppDataPanel>

      <Row className="g-3 mb-3">
        <Col md={4} xl={3}>
          <AppKpiCard
            value={stats?.totalPharmacies ?? '-'}
            label="登録薬局数"
            subLabel={`有効: ${stats?.activePharmacies ?? '-'} / 無効: ${stats?.inactivePharmacies ?? '-'}`}
            action={<Link to="/admin/pharmacies" className="btn btn-sm btn-outline-primary">登録薬局情報を見る</Link>}
          />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard value={stats?.totalPickupItems ?? '-'} label="引き取り数（明細件数）" />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard value={(stats?.totalExchangeValue ?? 0).toLocaleString()} label="交換金額（累計）" />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard
            value={stats?.totalExchanges ?? '-'}
            label="交換履歴件数"
            action={<Link to="/admin/exchanges" className="btn btn-sm btn-outline-primary">交換履歴を見る</Link>}
          />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard
            value={stats?.totalUploads ?? '-'}
            label="アップロード件数"
            action={<Link to="/admin/logs" className="btn btn-sm btn-outline-secondary">操作ログを見る</Link>}
          />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard
            value="マスター"
            label="医薬品マスター"
            valueClassName="h5"
            action={<Link to="/admin/drug-master" className="btn btn-sm btn-outline-primary">マスター管理</Link>}
          />
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col md={4} xl={3}>
          <AppKpiCard value={riskOverview?.highRiskPharmacies ?? '-'} label="高リスク薬局数" />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard value={riskOverview?.mediumRiskPharmacies ?? '-'} label="中リスク薬局数" />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard value={riskOverview?.lowRiskPharmacies ?? '-'} label="低リスク薬局数" />
        </Col>
        <Col md={4} xl={3}>
          <AppKpiCard
            value={riskOverview?.avgRiskScore ?? '-'}
            label="平均リスクスコア"
            action={<Link to="/admin/risk" className="btn btn-sm btn-outline-danger">詳細を見る</Link>}
          />
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col md={3}>
          <AppKpiCard value={observability?.totalRequests ?? '-'} label="60分リクエスト数" />
        </Col>
        <Col md={3}>
          <AppKpiCard
            value={observability?.p95LatencyMs ?? '-'}
            label="p95応答時間 (ms)"
            subLabel={`平均: ${observability?.avgLatencyMs ?? '-'} ms`}
          />
        </Col>
        <Col md={3}>
          <AppKpiCard
            value={observability?.errorRate5xx ?? '-'}
            label="5xxエラー率 (%)"
            subLabel={`件数: ${observability?.totalErrors5xx ?? '-'}`}
          />
        </Col>
        <Col md={3}>
          <AppKpiCard
            value={observability ? `${observability.authFailures401}/${observability.forbidden403}` : '-'}
            label="401/403 件数"
          />
        </Col>
      </Row>

      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <AppDataPanel title="遅延上位エンドポイント（過去60分）" className="mb-3">
          {!observability || observability.topSlowPaths.length === 0 ? (
            <div className="text-muted small">監視データがありません。</div>
          ) : (
            <AppResponsiveSwitch
              desktop={() => (
                <div className="table-responsive">
                  <AppTable striped size="sm" className="mb-0">
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
                  </AppTable>
                </div>
              )}
              mobile={() => (
                <div className="dl-mobile-data-list">
                  {observability.topSlowPaths.map((item) => (
                    <AppMobileDataCard
                      key={item.path}
                      title={item.path}
                      fields={[
                        { label: '件数', value: item.count },
                        { label: '平均 (ms)', value: item.avgLatencyMs },
                        { label: 'p95 (ms)', value: item.p95LatencyMs },
                      ]}
                    />
                  ))}
                </div>
              )}
            />
          )}
      </AppDataPanel>

      <Row className="g-3">
        <Col lg={5}>
          <AppDataPanel title="加盟薬局へのメッセージ送信">
              <Form onSubmit={handleSend}>
                <Form.Group className="mb-2" controlId="admin-message-target-type">
                  <Form.Label>送信対象</Form.Label>
                  <AppSelect
                    controlId="admin-message-target-type"
                    value={targetType}
                    ariaLabel="送信対象"
                    onChange={(value) => setTargetType(value as 'all' | 'pharmacy')}
                    options={[
                      { value: 'all', label: '全加盟薬局' },
                      { value: 'pharmacy', label: '特定薬局' },
                    ]}
                  />
                </Form.Group>

                {targetType === 'pharmacy' && (
                  <Form.Group className="mb-2" controlId="admin-message-target-pharmacy">
                    <Form.Label>送信先薬局</Form.Label>
                    <AppSelect
                      controlId="admin-message-target-pharmacy"
                      value={targetPharmacyId}
                      ariaLabel="送信先薬局"
                      onChange={setTargetPharmacyId}
                      required
                      placeholder="選択してください"
                      options={pharmacies
                        .filter((pharmacy) => pharmacy.isActive)
                        .map((pharmacy) => ({ value: String(pharmacy.id), label: `${pharmacy.name} (ID: ${pharmacy.id})` }))}
                    />
                  </Form.Group>
                )}

                <AppField
                  className="mb-2"
                  label="タイトル"
                  value={title}
                  onChange={setTitle}
                  maxLength={100}
                  required
                />

                <AppField
                  className="mb-2"
                  label="本文"
                  as="textarea"
                  rows={4}
                  value={body}
                  onChange={setBody}
                  maxLength={2000}
                  required
                />

                <AppField
                  className="mb-3"
                  label="通知クリック時の遷移先（任意）"
                  placeholder="/proposals など"
                  value={actionPath}
                  onChange={setActionPath}
                  helpText="先頭は / で入力してください。"
                />

                <LoadingButton type="submit" loading={sending} loadingLabel="送信中...">
                  送信
                </LoadingButton>
              </Form>
          </AppDataPanel>
        </Col>

        <Col lg={7}>
          <AppDataPanel title="送信済みメッセージ（最新10件）">
              {messages.length === 0 ? (
                <div className="text-muted small">送信済みメッセージはありません。</div>
              ) : (
                <AppResponsiveSwitch
                  desktop={() => (
                    <div className="table-responsive">
                      <AppTable striped size="sm" className="mobile-table">
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
                      </AppTable>
                    </div>
                  )}
                  mobile={() => (
                    <div className="dl-mobile-data-list">
                      {messages.map((item) => (
                        <AppMobileDataCard
                          key={item.id}
                          title={item.title}
                          subtitle={`ID: ${item.id}`}
                          fields={[
                            { label: '対象', value: item.targetType === 'all' ? '全体' : `薬局ID:${item.targetPharmacyId}` },
                            { label: '遷移先', value: item.actionPath || '-' },
                            { label: '送信日時', value: item.createdAt ? new Date(item.createdAt).toLocaleString('ja-JP') : '-' },
                          ]}
                        />
                      ))}
                    </div>
                  )}
                />
              )}
          </AppDataPanel>
        </Col>
      </Row>

    </div>
  );
}
