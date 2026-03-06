import { useCallback } from 'react';
import { Container, Row, Col, Badge } from 'react-bootstrap';
import AppKpiCard from '../components/ui/AppKpiCard';
import AppDataPanel from '../components/ui/AppDataPanel';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { api } from '../api/client';
import { formatYen, formatDateJa } from '../utils/formatters';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import InlineLoader from '../components/ui/InlineLoader';

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
      <h4 className="page-title mb-3">統計</h4>
      <ScrollArea>
        <Container>
          {children}
        </Container>
      </ScrollArea>
    </PageShell>
  );
}

export default function StatisticsPage() {
  const fetcher = useCallback(
    (signal: AbortSignal) => api.get<StatisticsSummary>('/statistics/summary', { signal }),
    [],
  );

  const { data, error, loading } = useAsyncResource(fetcher);
  const summary = data ?? EMPTY_STATS;
  const buckets = summary.inventory.bucketCounts;

  return (
    <StatisticsShell>
      {loading && <InlineLoader text="統計データを読み込み中..." />}
      {error && <div className="alert alert-danger">{error}</div>}
      {/* アクション待ち・アラート */}
      {(summary.proposals.pendingAction > 0 || summary.alerts.activeCount > 0) && (
        <AppDataPanel title="要対応" className="mb-3">
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

      {/* アップロード実績 */}
      <AppDataPanel title="アップロード実績">
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
      <AppDataPanel title="在庫状況" className="mt-3">
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
      <AppDataPanel title="マッチング・交換" className="mt-3">
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
      <AppDataPanel title="取引ネットワーク" className="mt-3">
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
    </StatisticsShell>
  );
}
