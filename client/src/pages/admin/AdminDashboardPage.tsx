import { useState, useEffect, FormEvent } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import { Badge, Row, Col, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import AppSelect from '../../components/ui/AppSelect';
import LoadingButton from '../../components/ui/LoadingButton';
import AppField from '../../components/ui/AppField';
import AppDataPanel from '../../components/ui/AppDataPanel';
import AppKpiCard from '../../components/ui/AppKpiCard';
import InlineLoader from '../../components/ui/InlineLoader';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AdminSentMessagesPanel, { type AdminMessage } from './components/AdminSentMessagesPanel';
import { formatDateTimeJa, formatNumberJa } from '../../utils/formatters';
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

interface OpenClawHealthSnapshot {
  status: 'ok' | 'degraded';
  timestamp: string;
  connector: { configured: boolean; mode: string };
  webhook: { configured: boolean };
  retryQueue: { pending: number; processing: number; completed: number; failed: number };
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
  ddsAgent: {
    connected: boolean;
    agentId: string | null;
    lastSeenAt: string | null;
    queuedJobs: number;
    awaitingUser: number;
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

interface CronStatusItem {
  name: string;
  label: string;
  lastActivityAt: string | null;
  evidenceNote: string;
}

interface CronStatusResponse {
  crons: CronStatusItem[];
}

interface SloBreachItem {
  id: number;
  type: 'db_health' | 'readiness' | 'rate_limit' | 'custom';
  details: string;
  timestamp: string;
}

interface SloBreachesResponse {
  data: SloBreachItem[];
  total: number;
}

const SLO_BREACH_LABELS: Record<SloBreachItem['type'], string> = {
  db_health: 'DBヘルス',
  readiness: 'Readiness',
  rate_limit: 'Rate Limit',
  custom: 'Custom',
};

function formatCronLastActivity(value: string | null): string {
  return value ? formatDateTimeJa(value) : '証跡なし';
}

function resolveSettledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function countRejectedResults(results: ReadonlyArray<PromiseSettledResult<unknown>>): number {
  return results.filter((result) => result.status === 'rejected').length;
}

function isOpenClawHealthSnapshot(value: unknown): value is OpenClawHealthSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<OpenClawHealthSnapshot>;
  return (candidate.status === 'ok' || candidate.status === 'degraded')
    && typeof candidate.timestamp === 'string'
    && !!candidate.connector
    && typeof candidate.connector.configured === 'boolean'
    && !!candidate.webhook
    && typeof candidate.webhook.configured === 'boolean'
    && !!candidate.retryQueue
    && typeof candidate.retryQueue.pending === 'number'
    && !!candidate.ddsAgent
    && typeof candidate.ddsAgent.connected === 'boolean';
}

function resolveOpenClawHealthResult(
  result: PromiseSettledResult<OpenClawHealthSnapshot>,
): { value: OpenClawHealthSnapshot | null; shouldCountAsError: boolean } {
  if (result.status === 'fulfilled') {
    return { value: result.value, shouldCountAsError: false };
  }

  if (
    result.reason instanceof ApiError
    && result.reason.status === 503
    && isOpenClawHealthSnapshot(result.reason.data)
    && result.reason.data.status === 'degraded'
  ) {
    return { value: result.reason.data, shouldCountAsError: false };
  }

  return { value: null, shouldCountAsError: true };
}

function buildAdminMessagePayload(input: {
  targetType: 'all' | 'pharmacy';
  targetPharmacyId: string;
  title: string;
  body: string;
  actionPath: string;
}) {
  return {
    targetType: input.targetType,
    targetPharmacyId: input.targetType === 'pharmacy' ? Number(input.targetPharmacyId) : null,
    title: input.title,
    body: input.body,
    actionPath: input.actionPath || null,
  };
}

const ADMIN_SHORTCUT_GROUPS = [
  {
    title: '今見る運用',
    description: '日次の監視、通知確認、取込品質確認をここから進めます。',
    links: [
      { to: '/admin/notifications', label: '通知・配信', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/upload-jobs', label: '取込ジョブ管理', className: 'btn btn-sm btn-outline-warning' },
      { to: '/admin/upload-quality', label: 'アップロード品質', className: 'btn btn-sm btn-outline-danger' },
      { to: '/admin/risk', label: '期限リスク分析', className: 'btn btn-sm btn-outline-danger' },
      { to: '/admin/openclaw', label: 'OpenClaw連携', className: 'btn btn-sm btn-primary' },
    ],
  },
  {
    title: '薬局運用・承認',
    description: '薬局運営、関係性、承認系の作業をまとめています。',
    links: [
      { to: '/admin/pharmacies', label: '薬局管理', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/groups', label: 'グループ管理', className: 'btn btn-sm btn-outline-info' },
      { to: '/admin/business-hours', label: '営業時間', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/relationships', label: '関係性監査', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/bulk-actions', label: '一括操作', className: 'btn btn-sm btn-outline-warning' },
    ],
  },
  {
    title: 'マッチング・マスター',
    description: '候補品質の最適化とマスター整備をまとめています。',
    links: [
      { to: '/admin/matching-rules', label: 'マッチングルール', className: 'btn btn-sm btn-outline-primary' },
      { to: '/admin/matching-experiments', label: 'マッチング実験', className: 'btn btn-sm btn-outline-primary' },
      { to: '/admin/matching-performance', label: 'マッチング性能', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/drug-master', label: '医薬品マスター', className: 'btn btn-sm btn-outline-primary' },
      { to: '/admin/drug-equivalences', label: '薬品同等性', className: 'btn btn-sm btn-outline-secondary' },
    ],
  },
  {
    title: '監査・保守',
    description: '障害解析、設定変更、監査証跡の確認をまとめています。',
    links: [
      { to: '/admin/direct-messages', label: 'ユーザー間メッセージ', className: 'btn btn-sm btn-outline-secondary' },
      { to: '/admin/user-requests', label: 'ユーザーリクエスト', className: 'btn btn-sm btn-outline-info' },
      { to: '/admin/alerts', label: 'アラート管理', className: 'btn btn-sm btn-outline-warning' },
      { to: '/admin/log-center', label: 'ログセンター', className: 'btn btn-sm btn-outline-dark' },
      { to: '/admin/error-codes', label: 'エラーコード', className: 'btn btn-sm btn-outline-dark' },
      { to: '/admin/audit', label: '監査ログ', className: 'btn btn-sm btn-outline-dark' },
      { to: '/admin/logs', label: '操作ログ', className: 'btn btn-sm btn-outline-dark' },
      { to: '/admin/rate-limits', label: 'レート制限設定', className: 'btn btn-sm btn-outline-dark' },
      { to: '/admin/reports', label: '月次レポート', className: 'btn btn-sm btn-outline-success' },
      { to: '/admin/exchanges', label: '交換履歴', className: 'btn btn-sm btn-outline-success' },
    ],
  },
] as const;

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [riskOverview, setRiskOverview] = useState<RiskOverview | null>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [alertsSummary, setAlertsSummary] = useState<AlertsSummary | null>(null);
  const [monitoringKpis, setMonitoringKpis] = useState<MonitoringKpiSnapshot | null>(null);
  const [openClawHealth, setOpenClawHealth] = useState<OpenClawHealthSnapshot | null>(null);
  const [cronStatus, setCronStatus] = useState<CronStatusItem[]>([]);
  const [sloBreaches, setSloBreaches] = useState<SloBreachesResponse | null>(null);
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
    const [statsResult, riskResult, observabilityResult, alertsResult, kpisResult, pharmacyResult, messagesResult, openClawResult, cronStatusResult, sloBreachesResult] = await Promise.allSettled([
      api.get<Stats>('/admin/stats'),
      api.get<RiskOverview>('/admin/risk/overview'),
      api.get<Observability>('/admin/observability?minutes=60'),
      api.get<AlertsSummary>('/admin/alerts'),
      api.get<MonitoringKpiSnapshot>('/admin/kpis?minutes=60'),
      api.get<{ data: PharmacyOption[] }>('/admin/pharmacies/options'),
      api.get<MessagesResponse>('/admin/messages?page=1&limit=10'),
      api.get<OpenClawHealthSnapshot>('/health/openclaw'),
      api.get<CronStatusResponse>('/admin/cron-status'),
      api.get<SloBreachesResponse>('/admin/slo-breaches?limit=5'),
    ]);

    const statsValue = resolveSettledValue(statsResult);
    const riskValue = resolveSettledValue(riskResult);
    const observabilityValue = resolveSettledValue(observabilityResult);
    const alertsValue = resolveSettledValue(alertsResult);
    const kpisValue = resolveSettledValue(kpisResult);
    const pharmacyValue = resolveSettledValue(pharmacyResult);
    const messagesValue = resolveSettledValue(messagesResult);
    const openClawResolution = resolveOpenClawHealthResult(openClawResult);
    const cronStatusValue = resolveSettledValue(cronStatusResult);
    const sloBreachesValue = resolveSettledValue(sloBreachesResult);

    if (statsValue) setStats(statsValue);
    if (riskValue) setRiskOverview(riskValue);
    if (observabilityValue) setObservability(observabilityValue);
    if (alertsValue) setAlertsSummary(alertsValue);
    if (kpisValue) setMonitoringKpis(kpisValue);
    if (pharmacyValue) setPharmacies(pharmacyValue.data);
    if (messagesValue) setMessages(messagesValue.data);
    if (openClawResolution.value) setOpenClawHealth(openClawResolution.value);
    if (cronStatusValue) setCronStatus(cronStatusValue.crons);
    if (sloBreachesValue) setSloBreaches(sloBreachesValue);

    const rejectedResults = [
      statsResult,
      riskResult,
      observabilityResult,
      alertsResult,
      kpisResult,
      pharmacyResult,
      messagesResult,
      cronStatusResult,
      sloBreachesResult,
      ...(openClawResolution.shouldCountAsError ? [openClawResult] : []),
    ];

    if (countRejectedResults(rejectedResults) > 0) {
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
      await api.post('/admin/messages', buildAdminMessagePayload({
        targetType,
        targetPharmacyId,
        title,
        body,
        actionPath,
      }));
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

      <AppDataPanel title="運用クイック導線" className="mb-3">
        <Row className="g-3">
          {ADMIN_SHORTCUT_GROUPS.map((group) => (
            <Col key={group.title} lg={6}>
              <div className="border rounded-3 p-3 h-100">
                <div className="fw-semibold mb-1">{group.title}</div>
                <div className="small text-muted mb-2">{group.description}</div>
                <div className="d-flex gap-2 flex-wrap mobile-stack">
                  {group.links.map((link) => (
                    <Link key={link.to} to={link.to} className={link.className}>
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </Col>
          ))}
        </Row>
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

      <AppDataPanel title="OpenClaw / DDS 状態" className="mb-3">
        <Row className="g-3">
          <Col md={3}>
            <AppKpiCard
              value={openClawHealth?.status === 'ok' ? '正常' : openClawHealth?.status === 'degraded' ? '要確認' : '-'}
              label="OpenClaw ヘルス"
              valueClassName={openClawHealth?.status === 'ok' ? 'h5 text-success' : 'h5 text-danger'}
              action={<Link to="/admin/openclaw" className="btn btn-sm btn-outline-primary">詳細を見る</Link>}
            />
          </Col>
          <Col md={3}>
            <AppKpiCard
              value={openClawHealth?.ddsAgent.connected ? '接続中' : '未接続'}
              label="DDS Agent"
              subLabel={openClawHealth?.ddsAgent.agentId ?? 'agent未登録'}
              valueClassName={openClawHealth?.ddsAgent.connected ? 'h5 text-success' : 'h5 text-warning'}
            />
          </Col>
          <Col md={3}>
            <AppKpiCard
              value={openClawHealth ? `${openClawHealth.retryQueue.pending}/${openClawHealth.retryQueue.failed}` : '-'}
              label="retry pending / failed"
              subLabel={openClawHealth?.lastHandoffAt ? `last handoff: ${openClawHealth.lastHandoffAt}` : undefined}
            />
          </Col>
          <Col md={3}>
            <AppKpiCard
              value={openClawHealth?.handoffSuccessRate != null ? `${Math.round(openClawHealth.handoffSuccessRate * 100)}%` : '-'}
              label="handoff 成功率 (30d)"
              subLabel={openClawHealth ? `queued:${openClawHealth.ddsAgent.queuedJobs} awaiting:${openClawHealth.ddsAgent.awaitingUser}` : undefined}
            />
          </Col>
        </Row>
      </AppDataPanel>

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

      <Row className="g-3 mb-3">
        <Col lg={7}>
          <AppDataPanel
            title="CRON ステータス"
            actions={<Link to="/admin/log-center" className="btn btn-sm btn-outline-secondary">ログセンター</Link>}
          >
            {cronStatus.length === 0 ? (
              <div className="text-muted small">CRON 実行証跡はまだありません。</div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {cronStatus.map((cron) => (
                  <div key={cron.name} className="border rounded p-2">
                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                      <div>
                        <div className="fw-semibold">{cron.label}</div>
                        <div className="small text-muted">{cron.evidenceNote}</div>
                      </div>
                      <Badge bg={cron.lastActivityAt ? 'success' : 'secondary'}>
                        {cron.lastActivityAt ? '実績あり' : '証跡なし'}
                      </Badge>
                    </div>
                    <div className="small mt-2">{formatCronLastActivity(cron.lastActivityAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </AppDataPanel>
        </Col>
        <Col lg={5}>
          <AppDataPanel
            title="SLO 違反履歴"
            actions={<Link to="/admin/logs" className="btn btn-sm btn-outline-secondary">操作ログ</Link>}
          >
            <div className="small text-muted mb-2">
              保存件数: {sloBreaches?.total ?? 0}
            </div>
            {!sloBreaches || sloBreaches.data.length === 0 ? (
              <div className="text-muted small">現在表示できる SLO 違反はありません。</div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {sloBreaches.data.map((breach) => (
                  <div key={breach.id} className="border rounded p-2">
                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                      <Badge bg="warning" text="dark">{SLO_BREACH_LABELS[breach.type]}</Badge>
                      <div className="small text-muted">{formatDateTimeJa(breach.timestamp)}</div>
                    </div>
                    <div className="small mt-2">{breach.details}</div>
                  </div>
                ))}
              </div>
            )}
          </AppDataPanel>
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
