import { lazy, Suspense, useState } from 'react';
import { Container, Row, Col, Badge, ButtonGroup, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppKpiCard from '../components/ui/AppKpiCard';
import AppDataPanel from '../components/ui/AppDataPanel';
import { api } from '../api/client';
import { useApiQuery } from '../hooks/useApiQuery';
import { formatYen, formatDateJa } from '../utils/formatters';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import InlineLoader from '../components/ui/InlineLoader';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';

const TrendChart = lazy(() => import('../components/charts/TrendChart'));

type TrendDays = 30 | 60 | 90;

interface TrendRow {
  date: string;
  metrics: {
    deadStockCount?: number;
    usedMedCount?: number;
    proposalsSent?: number;
    proposalsReceived?: number;
    proposalsCompleted?: number;
    exchangeValue?: number;
    [key: string]: unknown;
  };
}

interface TrendResponse {
  trends: TrendRow[];
  days: number;
  startDate: string;
}

interface TrendDataPoint {
  date: string;
  deadStockCount: number | null;
  usedMedCount: number | null;
  proposalsSent: number | null;
  proposalsReceived: number | null;
  proposalsCompleted: number | null;
  exchangeValue: number | null;
  [key: string]: unknown;
}

function normalizeTrends(rows: TrendRow[]): TrendDataPoint[] {
  return rows.map((row) => ({
    date: row.date,
    deadStockCount: row.metrics.deadStockCount ?? null,
    usedMedCount: row.metrics.usedMedCount ?? null,
    proposalsSent: row.metrics.proposalsSent ?? null,
    proposalsReceived: row.metrics.proposalsReceived ?? null,
    proposalsCompleted: row.metrics.proposalsCompleted ?? null,
    exchangeValue: row.metrics.exchangeValue ?? null,
  }));
}

interface BucketCounts {
  expired: number;
  within30: number;
  within60: number;
  within90: number;
  within120: number;
  over120: number;
  unknown: number;
}

interface StatisticsSummary {
  uploads: {
    deadStockCount: number;
    usedMedicationCount: number;
    lastDeadStockUpload: string | null;
    lastUsedMedicationUpload: string | null;
  };
  inventory: {
    deadStockItems: number;
    deadStockTotalValue: number;
    riskScore: number;
    bucketCounts: BucketCounts | null;
  };
  proposals: {
    sent: number;
    received: number;
    completed: number;
    pendingAction: number;
  };
  exchanges: {
    totalCount: number;
    totalValue: number;
  };
  matching: {
    candidateCount: number;
  };
  trust: {
    score: number;
    ratingCount: number;
    positiveRate: number;
    avgRatingReceived: number;
    feedbackCount: number;
  };
  network: {
    favoriteCount: number;
    tradingPartnerCount: number;
  };
  alerts: {
    activeCount: number;
  };
}
const EMPTY_STATS: StatisticsSummary = {
  uploads: {
    deadStockCount: 0,
    usedMedicationCount: 0,
    lastDeadStockUpload: null,
    lastUsedMedicationUpload: null,
  },
  inventory: {
    deadStockItems: 0,
    deadStockTotalValue: 0,
    riskScore: 0,
    bucketCounts: null,
  },
  proposals: {
    sent: 0,
    received: 0,
    completed: 0,
    pendingAction: 0,
  },
  exchanges: {
    totalCount: 0,
    totalValue: 0,
  },
  matching: {
    candidateCount: 0,
  },
  trust: {
    score: 0,
    ratingCount: 0,
    positiveRate: 0,
    avgRatingReceived: 0,
    feedbackCount: 0,
  },
  network: {
    favoriteCount: 0,
    tradingPartnerCount: 0,
  },
  alerts: {
    activeCount: 0,
  },
};

function riskScoreVariant(score: number): string {
  if (score >= 65) return 'text-danger';
  if (score >= 35) return 'text-warning';
  return 'text-success';
}

function hasAttentionSection(summary: StatisticsSummary): boolean {
  return summary.proposals.pendingAction > 0 || summary.alerts.activeCount > 0;
}

function isAllZero(summary: StatisticsSummary): boolean {
  return (
    summary.uploads.deadStockCount === 0 &&
    summary.uploads.usedMedicationCount === 0 &&
    summary.inventory.deadStockItems === 0 &&
    summary.proposals.sent === 0 &&
    summary.proposals.received === 0 &&
    summary.proposals.completed === 0 &&
    summary.exchanges.totalCount === 0
  );
}

function BucketRiskBadges({ buckets }: { buckets: BucketCounts }) {
  const hasRisk = buckets.expired > 0 || buckets.within30 > 0 || buckets.within60 > 0 || buckets.within90 > 0;

  if (!hasRisk) {
    return <span className="text-success">問題なし</span>;
  }

  return (
    <span>
      {buckets.expired > 0 && <Badge bg="danger" className="me-1">期限切れ {buckets.expired}</Badge>}
      {buckets.within30 > 0 && <Badge bg="warning" text="dark" className="me-1">30日以内 {buckets.within30}</Badge>}
      {(buckets.within60 > 0 || buckets.within90 > 0) && (
        <Badge bg="info">90日以内 {buckets.within60 + buckets.within90}</Badge>
      )}
    </span>
  );
}

function StatisticsShell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">統計</h4>
          <div className="text-muted small">アップロード、在庫、マッチング、ネットワークの集計をまとめて確認します。</div>
        </div>
        <div className="dl-page-header-actions mobile-stack">
          <Link to="/matching" className="btn btn-primary btn-sm">候補を確認</Link>
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'dashboard', to: '/', label: 'ダッシュボードへ戻る' },
              { key: 'dead-stock', to: '/inventory/dead-stock', label: 'デッドストックを確認' },
              { key: 'quality', to: '/upload-quality', label: '品質を確認' },
              { key: 'alerts', to: '/alerts', label: 'アラートを確認' },
              { key: 'proposals', to: '/proposals', label: '提案一覧を確認' },
              { key: 'groups', to: '/groups', label: 'グループを確認' },
            ]}
          />
        </div>
      </div>
      <ScrollArea>
        <Container>
          {children}
        </Container>
      </ScrollArea>
    </PageShell>
  );
}

function ChartFallback({ text }: { text: string }) {
  return <InlineLoader text={text} />;
}

function SectionActions({ links }: { links: Array<{ to: string; label: string; variant?: string }> }) {
  const [primaryLink, ...secondaryLinks] = links;
  if (!primaryLink) return null;

  return (
    <div className="dl-action-row mobile-stack">
      <Link
        to={primaryLink.to}
        className={`btn btn-sm ${primaryLink.variant ?? 'btn-outline-secondary'} py-0`}
      >
        {primaryLink.label}
      </Link>
      {secondaryLinks.length > 0 ? (
        <AppDropdownMenu
          label="関連"
          size="sm"
          variant="outline-secondary"
          items={secondaryLinks.map((link) => ({
            key: `${link.to}:${link.label}`,
            to: link.to,
            label: link.label,
          }))}
        />
      ) : null}
    </div>
  );
}

export default function StatisticsPage() {
  const [trendDays, setTrendDays] = useState<TrendDays>(30);

  const {
    data,
    error,
    isLoading: loading,
  } = useApiQuery(
    ['statistics-summary'],
    ({ signal }) => api.get<StatisticsSummary>('/statistics/summary', { signal }),
  );

  const {
    data: trendData,
    isLoading: trendLoading,
  } = useApiQuery(
    ['statistics-trends', trendDays],
    ({ signal }) => api.get<TrendResponse>(`/statistics/trends?days=${trendDays}`, { signal }),
  );

  const queryError = error instanceof Error ? error.message : '';
  const summary = data ?? EMPTY_STATS;
  const buckets = summary.inventory.bucketCounts;
  const trendPoints: TrendDataPoint[] = trendData ? normalizeTrends(trendData.trends) : [];

  return (
      <StatisticsShell>
        {loading && <InlineLoader text="統計データを読み込み中..." />}
        {queryError && <div className="alert alert-danger">{queryError}</div>}
      {/* アクション待ち・アラート */}
      {hasAttentionSection(summary) && (
        <AppDataPanel
          title="要対応"
          className="mb-3"
          actions={(
            summary.proposals.pendingAction > 0 ? (
              <div className="dl-action-row mobile-stack">
                <Link to="/proposals" className="btn btn-outline-secondary btn-sm py-0">提案を確認</Link>
                {summary.alerts.activeCount > 0 ? (
                  <AppDropdownMenu
                    label="関連"
                    size="sm"
                    variant="outline-secondary"
                    items={[
                      { key: 'alerts', to: '/alerts', label: 'アラートを確認', danger: true },
                    ]}
                  />
                ) : null}
              </div>
            ) : summary.alerts.activeCount > 0 ? (
              <Link to="/alerts" className="btn btn-outline-danger btn-sm py-0">アラートを確認</Link>
            ) : null
          )}
        >
          <Row className="g-3">
            {summary.proposals.pendingAction > 0 && (
              <Col xs={6}>
                <AppKpiCard
                  value={<span className="text-warning">{summary.proposals.pendingAction}</span>}
                  label="対応待ち提案"
                />
              </Col>
            )}
            {summary.alerts.activeCount > 0 && (
              <Col xs={6}>
                <AppKpiCard
                  value={<span className="text-danger">{summary.alerts.activeCount}</span>}
                  label="未解決アラート"
                />
              </Col>
            )}
          </Row>
        </AppDataPanel>
      )}

      {/* ゼロデータ案内 */}
      {!loading && isAllZero(summary) && (
        <p className="text-muted small text-center mt-2 mb-3">
          データがアップロードされると統計情報が表示されます
        </p>
      )}

      {/* アップロード実績 */}
      <AppDataPanel
        title="アップロード実績"
        actions={<SectionActions links={[{ to: '/upload', label: 'アップロード', variant: 'btn-outline-primary' }]} />}
      >
        <Row className="g-3">
          <Col xs={6} md={3}>
            <AppKpiCard
              value={summary.uploads.deadStockCount}
              label="デッドストック"
              subLabel="アップロード回数"
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={summary.uploads.usedMedicationCount}
              label="医薬品使用量"
              subLabel="アップロード回数"
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={formatDateJa(summary.uploads.lastDeadStockUpload, '未実施')}
              label="最終アップロード"
              subLabel="デッドストック"
              valueClassName="h5"
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={formatDateJa(summary.uploads.lastUsedMedicationUpload, '未実施')}
              label="最終アップロード"
              subLabel="医薬品使用量"
              valueClassName="h5"
            />
          </Col>
        </Row>
      </AppDataPanel>

      {/* 在庫状況 */}
      <AppDataPanel
        title="在庫状況"
        className="mt-3"
        actions={<SectionActions links={[
          { to: '/inventory/dead-stock', label: 'デッドストックを確認', variant: 'btn-outline-primary' },
          { to: '/inventory/used-medication', label: '使用量リストを確認' },
          { to: '/inventory/browse', label: '在庫参照を確認' },
        ]} />}
      >
        <Row className="g-3">
          <Col xs={6} md={3}>
            <AppKpiCard
              value={summary.inventory.deadStockItems}
              label="デッドストック品目数"
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={formatYen(summary.inventory.deadStockTotalValue)}
              label="デッドストック総額"
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={<span className={riskScoreVariant(summary.inventory.riskScore)}>{summary.inventory.riskScore}</span>}
              label="リスクスコア"
            />
          </Col>
          {buckets && (
            <Col xs={6} md={3}>
              <AppKpiCard
                value={<BucketRiskBadges buckets={buckets} />}
                label="期限リスク内訳"
                valueClassName="h6"
              />
            </Col>
          )}
        </Row>
      </AppDataPanel>

      {/* マッチング・交換 */}
      <AppDataPanel
        title="マッチング・交換"
        className="mt-3"
        actions={(
          <SectionActions
            links={[
              { to: '/matching', label: '候補を確認', variant: 'btn-outline-primary' },
              { to: '/proposals', label: '提案一覧を確認' },
              { to: '/exchange-history', label: '交換履歴を確認' },
            ]}
          />
        )}
      >
        <Row className="g-3">
          <Col xs={6} md={4}>
            <AppKpiCard value={summary.proposals.sent} label="送信した提案" />
          </Col>
          <Col xs={6} md={4}>
            <AppKpiCard value={summary.proposals.received} label="受信した提案" />
          </Col>
          <Col xs={6} md={4}>
            <AppKpiCard value={summary.proposals.completed} label="完了済み提案" />
          </Col>
          <Col xs={6} md={4}>
            <AppKpiCard value={summary.exchanges.totalCount} label="交換完了件数" />
          </Col>
          <Col xs={6} md={4}>
            <AppKpiCard value={formatYen(summary.exchanges.totalValue)} label="累計交換薬価" />
          </Col>
          <Col xs={6} md={4}>
            <AppKpiCard value={summary.matching.candidateCount} label="マッチング候補数" />
          </Col>
        </Row>
      </AppDataPanel>

      {/* 信頼・評価 */}
      <AppDataPanel title="信頼・評価" className="mt-3">
        <Row className="g-3">
          <Col xs={6} md={3}>
            <AppKpiCard value={summary.trust.score} label="信頼スコア" />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={summary.trust.feedbackCount > 0 ? `${summary.trust.avgRatingReceived} / 5` : '-'}
              label="平均評価"
              subLabel={summary.trust.feedbackCount > 0 ? `${summary.trust.feedbackCount}件の評価` : '評価なし'}
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard
              value={summary.trust.ratingCount > 0 ? `${summary.trust.positiveRate}%` : '-'}
              label="高評価率"
              subLabel="評価4以上の割合"
            />
          </Col>
          <Col xs={6} md={3}>
            <AppKpiCard value={summary.trust.ratingCount} label="評価件数" />
          </Col>
        </Row>
      </AppDataPanel>

      {/* 取引ネットワーク */}
      <AppDataPanel
        title="取引ネットワーク"
        className="mt-3"
        actions={(
          <SectionActions
            links={[
              { to: '/pharmacies', label: '薬局一覧', variant: 'btn-outline-primary' },
              { to: '/groups', label: 'グループ' },
            ]}
          />
        )}
      >
        <Row className="g-3">
          <Col xs={6}>
            <AppKpiCard
              value={summary.network.tradingPartnerCount}
              label="取引先数"
              subLabel="交換実績がある薬局"
            />
          </Col>
          <Col xs={6}>
            <AppKpiCard value={summary.network.favoriteCount} label="お気に入り薬局数" />
          </Col>
        </Row>
      </AppDataPanel>

      {/* 月次推移グラフ */}
      <AppDataPanel title="月次推移" className="mt-3">
        <div className="d-flex justify-content-end mb-3">
          <ButtonGroup size="sm">
            {([30, 60, 90] as TrendDays[]).map((d) => (
              <Button
                key={d}
                variant={trendDays === d ? 'primary' : 'outline-secondary'}
                onClick={() => setTrendDays(d)}
              >
                {d}日
              </Button>
            ))}
          </ButtonGroup>
        </div>
        {trendLoading && <InlineLoader text="推移データを読み込み中..." />}
        <Row className="g-4">
          <Col xs={12} md={6}>
            <p className="fw-semibold mb-1 small text-muted">デッドストック推移</p>
            <Suspense fallback={<ChartFallback text="デッドストック推移を読み込み中..." />}>
              <TrendChart
                data={trendPoints}
                lines={[
                  { key: 'deadStockCount', label: 'デッドストック数', color: '#dc3545' },
                ]}
              />
            </Suspense>
          </Col>
          <Col xs={12} md={6}>
            <p className="fw-semibold mb-1 small text-muted">医薬品使用量推移</p>
            <Suspense fallback={<ChartFallback text="医薬品使用量推移を読み込み中..." />}>
              <TrendChart
                data={trendPoints}
                lines={[
                  { key: 'usedMedCount', label: '医薬品使用量', color: '#6f42c1' },
                ]}
              />
            </Suspense>
          </Col>
          <Col xs={12} md={6}>
            <p className="fw-semibold mb-1 small text-muted">提案数推移</p>
            <Suspense fallback={<ChartFallback text="提案数推移を読み込み中..." />}>
              <TrendChart
                data={trendPoints}
                lines={[
                  { key: 'proposalsSent', label: '送信', color: '#0d6efd' },
                  { key: 'proposalsReceived', label: '受信', color: '#6f42c1' },
                  { key: 'proposalsCompleted', label: '完了', color: '#198754' },
                ]}
              />
            </Suspense>
          </Col>
          <Col xs={12} md={6}>
            <p className="fw-semibold mb-1 small text-muted">交換額推移 (円)</p>
            <Suspense fallback={<ChartFallback text="交換額推移を読み込み中..." />}>
              <TrendChart
                data={trendPoints}
                lines={[
                  { key: 'exchangeValue', label: '交換薬価', color: '#fd7e14' },
                ]}
              />
            </Suspense>
          </Col>
        </Row>
      </AppDataPanel>
    </StatisticsShell>
  );
}
