import { Badge, Col, Row } from 'react-bootstrap';
import type { MatchCandidate, MatchPriorityReason } from '../../types/matching';
import AppDataPanel from '../ui/AppDataPanel';
import AppTable from '../ui/AppTable';
import { formatYen } from '../../utils/formatters';

interface MatchCandidateInsightsPanelProps {
  candidate: MatchCandidate;
}

function formatPercent(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

function formatMetric(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return value.toLocaleString();
}

function formatPriorityReasonValue(reason: MatchPriorityReason): string {
  return reason.code === 'mutual_exchange_value'
    ? formatYen(reason.value)
    : formatMetric(reason.value);
}

export default function MatchCandidateInsightsPanel({ candidate }: MatchCandidateInsightsPanelProps) {
  const score = candidate.scoreBreakdown;
  const priority = candidate.priorityBreakdown;
  const reasons = candidate.priorityReasons ?? [];
  const businessImpact = candidate.businessImpact;

  return (
    <AppDataPanel title="評価内訳" className="mb-3" bodyClassName="small">
      <Row className="g-3">
        <Col lg={4}>
          <div className="d-flex flex-column gap-2">
            <div>
              <div className="text-muted small">総合スコア</div>
              <div className="h4 mb-0">{candidate.score?.toFixed(1) ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted small">一致率</div>
              <div className="fw-semibold">{formatPercent(candidate.matchRate)}</div>
            </div>
            <div>
              <div className="text-muted small">距離</div>
              <div className="fw-semibold">{candidate.distance}km</div>
            </div>
          </div>
        </Col>
        <Col lg={8}>
          <div className="table-responsive">
            <AppTable bordered size="sm" className="mb-0 mobile-table">
              <thead className="table-light">
                <tr>
                  <th>スコア要素</th>
                  <th className="text-end">値</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['薬価', score?.valueScore],
                  ['差額バランス', score?.balanceScore],
                  ['距離', score?.distanceScore],
                  ['期限', score?.expiryScore],
                  ['多様性', score?.diversityScore],
                  ['お気に入り加点', score?.favoriteBonus],
                  ['グループ加点', score?.groupBonus],
                  ['成功率加点', score?.successRateBonus],
                  ['合計', score?.total],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="text-end">{typeof value === 'number' ? value.toFixed(1) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
          </div>
        </Col>
      </Row>

      <Row className="g-3 mt-1">
        <Col lg={6}>
          <div className="fw-semibold mb-2">優先理由</div>
          {reasons.length > 0 ? (
            <div className="d-flex flex-wrap gap-1">
              {reasons.map((reason) => (
                <Badge key={reason.code} bg="secondary" text="dark" className="text-wrap">
                  {reason.label} {formatPriorityReasonValue(reason)}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-muted">-</div>
          )}
        </Col>
        <Col lg={6}>
          <div className="fw-semibold mb-2">事業インパクト</div>
          {businessImpact ? (
            <div className="d-flex flex-column gap-1">
              <div>廃棄回避額: {formatYen(businessImpact.estimatedWasteAvoidanceYen)}</div>
              <div>運転資金解放額: {formatYen(businessImpact.estimatedWorkingCapitalReleaseYen)}</div>
              <div>相互解消件数: {formatMetric(businessImpact.estimatedMutualLiquidationItems)}</div>
              <div>期限切迫解消件数: {formatMetric(businessImpact.estimatedMutualNearExpiryItems)}</div>
              <div>追跡可能在庫件数: {formatMetric(businessImpact.estimatedTraceableExchangeItems)}</div>
            </div>
          ) : (
            <div className="text-muted">-</div>
          )}
        </Col>
      </Row>

      {priority ? (
        <div className="mt-3">
          <div className="fw-semibold mb-2">優先度ブレイクダウン</div>
          <div className="d-flex flex-wrap gap-1">
            <Badge bg="light" text="dark">相互不動在庫 {priority.mutualStagnantItems}</Badge>
            <Badge bg="light" text="dark">相互期限切迫 {priority.mutualNearExpiryItems}</Badge>
            <Badge bg="light" text="dark">相互交換額 {formatYen(priority.mutualExchangeValue)}</Badge>
            <Badge bg="light" text="dark">相互品目数 {priority.mutualItemCount}</Badge>
            <Badge bg="light" text="dark">追跡可能在庫 {priority.mutualTraceableItems}</Badge>
          </div>
        </div>
      ) : null}
    </AppDataPanel>
  );
}
