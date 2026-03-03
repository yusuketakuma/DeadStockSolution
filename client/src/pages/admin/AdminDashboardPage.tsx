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
import AdminSentMessagesPanel, { type AdminMessage } from './components/AdminSentMessagesPanel';
import { formatNumberJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

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
  logPush?: {
    enqueued: number;
    sent: number;
    failed: number;
    retried: number;
  };
}

interface AlertsSummary {
  failedUploadJobs24h: number;
  stalledUploadJobs24h: number;
  unreadNotifications: number;
  pendingProposalActions24h: number;
}

interface MonitoringKpiSnapshot {
  status: 'healthy' | 'warning';
  metrics: {
    errorRate5xx: number;
    uploadFailureRate: number;
    pendingUploadStaleCount: number;
  };
  thresholds: {
    errorRate5xx: number;
    uploadFailureRate: number;
    pendingStaleCount: number;
    pendingStaleMinutes: number;
  };
  breaches: {
    errorRate5xx: boolean;
    uploadFailureRate: boolean;
    pendingStaleCount: boolean;
  };
  context: {
    windowMinutes: number;
    uploadWindowHours: number;
  };
}

interface PharmacyOption {
  id: number;
  name: string;
  isActive: boolean;
}

interface MessagesResponse {
  data: AdminMessage[];
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [riskOverview, setRiskOverview] = useState<RiskOverview | null>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [alertsSummary, setAlertsSummary] = useState<AlertsSummary | null>(null);
  const [monitoringKpis, setMonitoringKpis] = useState<MonitoringKpiSnapshot | null>(null);
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
    const [statsResult, riskResult, observabilityResult, alertsResult, kpisResult, pharmacyResult, messagesResult] = await Promise.allSettled([
      api.get<Stats>('/admin/stats'),
      api.get<RiskOverview>('/admin/risk/overview'),
      api.get<Observability>('/admin/observability?minutes=60'),
      api.get<AlertsSummary>('/admin/alerts'),
      api.get<MonitoringKpiSnapshot>('/admin/kpis?minutes=60'),
      api.get<{ data: PharmacyOption[] }>('/admin/pharmacies/options'),
      api.get<MessagesResponse>('/admin/messages?page=1&limit=10'),
    ]);

    if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    if (riskResult.status === 'fulfilled') setRiskOverview(riskResult.value);
    if (observabilityResult.status === 'fulfilled') setObservability(observabilityResult.value);
    if (alertsResult.status === 'fulfilled') setAlertsSummary(alertsResult.value);
    if (kpisResult.status === 'fulfilled') setMonitoringKpis(kpisResult.value);
    if (pharmacyResult.status === 'fulfilled') setPharmacies(pharmacyResult.value.data);
    if (messagesResult.status === 'fulfilled') setMessages(messagesResult.value.data);

    const failures = [statsResult, riskResult, observabilityResult, alertsResult, kpisResult, pharmacyResult, messagesResult]
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

  function toKpiValueClassName(breach: boolean): string {
    return breach ? 'h5 text-danger' : 'h5 text-success';
  }

  return (
    <PageShell>
      <h4 className="page-title mb-3">管理者ダッシュボード</h4>
      <ScrollArea>
      {loading && !stats && (
        <InlineLoader text="管理データを読み込み中..." className="text-muted small mb-3" />
      )}

      <AppDataPanel title="運用クイック導線" className="mb-3" bodyClassName="d-flex gap-2 flex-wrap mobile-stack">
          <Link to="/admin/openclaw" className="btn btn-sm btn-primary">OpenClaw連携を確認</Link>
          <Link to="/admin/risk" className="btn btn-sm btn-outline-danger">期限リスク分析</Link>
          <Link to="/admin/reports" className="btn btn-sm btn-outline-success">月次レポート</Link>
          <Link to="/admin/upload-jobs" className="btn btn-sm btn-outline-warning">取込ジョブ管理</Link>
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
          <AppKpiCard value={formatNumberJa(stats?.totalExchangeValue ?? 0)} label="交換金額（累計）" />
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
            action={<Link to="/admin/upload-jobs" className="btn btn-sm btn-outline-secondary">ジョブ一覧を見る</Link>}
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
          <AppKpiCard value={alertsSummary?.failedUploadJobs24h ?? '-'} label="取込失敗ジョブ (24h)" />
        </Col>
        <Col md={3}>
          <AppKpiCard value={alertsSummary?.stalledUploadJobs24h ?? '-'} label="取込保留ジョブ (24h)" />
        </Col>
        <Col md={3}>
          <AppKpiCard value={alertsSummary?.unreadNotifications ?? '-'} label="未読通知" />
        </Col>
        <Col md={3}>
          <AppKpiCard value={alertsSummary?.pendingProposalActions24h ?? '-'} label="要対応提案 (24h)" />
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col md={3}>
          <AppKpiCard
            value={monitoringKpis?.status === 'warning' ? '要対応' : monitoringKpis?.status === 'healthy' ? '正常' : '-'}
            label="運用KPIステータス"
            valueClassName={monitoringKpis?.status === 'warning' ? 'h5 text-danger' : 'h5 text-success'}
          />
        </Col>
        <Col md={3}>
          <AppKpiCard
            value={monitoringKpis?.metrics.errorRate5xx ?? '-'}
            label="API 5xx率 (%)"
            subLabel={`閾値: ${monitoringKpis?.thresholds.errorRate5xx ?? '-'}%`}
            valueClassName={toKpiValueClassName(Boolean(monitoringKpis?.breaches.errorRate5xx))}
          />
        </Col>
        <Col md={3}>
          <AppKpiCard
            value={monitoringKpis?.metrics.uploadFailureRate ?? '-'}
            label="取込失敗率 (%)"
            subLabel={`閾値: ${monitoringKpis?.thresholds.uploadFailureRate ?? '-'}%`}
            valueClassName={toKpiValueClassName(Boolean(monitoringKpis?.breaches.uploadFailureRate))}
          />
        </Col>
        <Col md={3}>
          <AppKpiCard
            value={monitoringKpis?.metrics.pendingUploadStaleCount ?? '-'}
            label="滞留取込ジョブ"
            subLabel={`閾値: ${monitoringKpis?.thresholds.pendingStaleCount ?? '-'}件 (${monitoringKpis?.thresholds.pendingStaleMinutes ?? '-'}分超)`}
            valueClassName={toKpiValueClassName(Boolean(monitoringKpis?.breaches.pendingStaleCount))}
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
        <Col md={3}>
          <AppKpiCard
            value={observability?.logPush ? `${observability.logPush.sent}/${observability.logPush.failed}` : '-'}
            label="OpenClawログ送信 成功/失敗"
            subLabel={observability?.logPush ? `queued:${observability.logPush.enqueued} retry:${observability.logPush.retried}` : undefined}
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
          <AdminSentMessagesPanel messages={messages} />
        </Col>
      </Row>

      </ScrollArea>
    </PageShell>
  );
}
