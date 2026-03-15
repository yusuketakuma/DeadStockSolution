import { memo } from 'react';
import { Row, Col } from 'react-bootstrap';
import AppCard from '../../../components/ui/AppCard';
import type { LogCenterSummary, LogInsightsSummary } from '../../../types/admin-log-center';

interface SummaryCardsProps {
  summary: LogCenterSummary | null;
}

export const SummaryCards = memo(function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <Row className="g-2 mb-3">
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">総ログ数</div>
          <div className="fs-4 fw-semibold">{summary?.total ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">エラー</div>
          <div className="fs-4 fw-semibold text-danger">{summary?.errors ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">警告</div>
          <div className="fs-4 fw-semibold text-warning">{summary?.warnings ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">本日</div>
          <div className="fs-4 fw-semibold">{summary?.today ?? 0}</div>
        </AppCard>
      </Col>
    </Row>
  );
});

interface InsightCardsProps {
  insights: LogInsightsSummary | null;
}

export const InsightCards = memo(function InsightCards({ insights }: InsightCardsProps) {
  return (
    <Row className="g-2 mb-3">
      <Col md={4}>
        <AppCard body className="h-100">
          <div className="small text-muted">再発中の論点</div>
          <div className="fs-4 fw-semibold text-danger">{insights?.repeatedErrorCount ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={4}>
        <AppCard body className="h-100">
          <div className="small text-muted">影響テナント数</div>
          <div className="fs-4 fw-semibold">{insights?.impactedTenantCount ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={4}>
        <AppCard body className="h-100">
          <div className="small text-muted">上位再発論点</div>
          <div className="small text-muted">
            {insights?.topIssues[0]
              ? `${insights.topIssues[0].title} (${insights.topIssues[0].count}件)`
              : '再発検知なし'}
          </div>
        </AppCard>
      </Col>
    </Row>
  );
});
