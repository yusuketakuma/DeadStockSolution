import { useCallback, useEffect, useState } from 'react';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppTable from '../../components/ui/AppTable';
import AppKpiCard from '../../components/ui/AppKpiCard';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import InlineLoader from '../../components/ui/InlineLoader';
import Pagination from '../../components/Pagination';
import { api } from '../../api/client';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatCountJa, formatNumberJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface BucketCounts {
  expired: number;
  within30: number;
  within60: number;
  within90: number;
  within120: number;
  over120: number;
  unknown: number;
}

interface PharmacyRiskSummary {
  pharmacyId: number;
  pharmacyName: string;
  totalItems: number;
  riskScore: number;
  bucketCounts: BucketCounts;
}

interface RiskOverview {
  totalPharmacies: number;
  highRiskPharmacies: number;
  mediumRiskPharmacies: number;
  lowRiskPharmacies: number;
  avgRiskScore: number;
  totalBucketCounts: BucketCounts;
  topHighRiskPharmacies: PharmacyRiskSummary[];
  computedAt: string;
}

interface RiskListResponse {
  data: PharmacyRiskSummary[];
  pagination: { page: number; totalPages: number; total: number };
}

function getRiskBadgeClass(score: number): string {
  if (score >= 65) return 'text-danger fw-semibold';
  if (score >= 35) return 'text-warning fw-semibold';
  return 'text-success fw-semibold';
}

export default function AdminRiskPage() {
  const [overview, setOverview] = useState<RiskOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const fetchRiskList = useCallback((targetPage: number, signal?: AbortSignal) =>
    api.get<RiskListResponse>(`/admin/risk/pharmacies?page=${targetPage}`, { signal }), []);
  const {
    items: rows,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<PharmacyRiskSummary, RiskListResponse>(fetchRiskList, {
    errorMessage: '期限リスクデータの取得に失敗しました',
  });

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const overviewData = await api.get<RiskOverview>('/admin/risk/overview');
      setOverview(overviewData);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : 'リスク概要データの取得に失敗しました');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const handleRetry = () => {
    void fetchOverview();
    void retry();
  };

  const hasError = Boolean(error || overviewError);
  const mergedErrorMessage = error || overviewError;

  return (
    <PageShell>
      <h4 className="page-title mb-3">期限切れリスク分析</h4>
      {hasError && (
        <ErrorRetryAlert error={mergedErrorMessage} onRetry={handleRetry} />
      )}

      {(overviewLoading && !overview) || (loading && rows.length === 0) ? (
        <InlineLoader text="リスク分析データを読み込み中..." className="text-muted small" />
      ) : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <AppKpiCard value={formatCountJa(overview?.totalPharmacies)} label="対象薬局数" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={formatCountJa(overview?.highRiskPharmacies)} label="高リスク薬局" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={formatCountJa(overview?.mediumRiskPharmacies)} label="中リスク薬局" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={overview ? Number(overview.avgRiskScore).toFixed(1) : '-'} label="平均リスクスコア" />
            </div>
          </div>

          <ScrollArea>
          {rows.length === 0 ? (
            <AppEmptyState title="リスクデータがありません" description="在庫アップロード後に分析されます。" />
          ) : (
            <AppResponsiveSwitch
              desktop={() => (
                <div className="table-responsive">
                  <AppTable striped hover className="mobile-table">
                    <thead>
                      <tr>
                        <th>薬局</th>
                        <th>総件数</th>
                        <th>リスク</th>
                        <th>期限切れ</th>
                        <th>30日以内</th>
                        <th>60日以内</th>
                        <th>90日以内</th>
                        <th>120日以内</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.pharmacyId}>
                          <td>{row.pharmacyName}</td>
                          <td>{formatNumberJa(row.totalItems)}</td>
                          <td className={getRiskBadgeClass(row.riskScore)}>{row.riskScore.toFixed(1)}</td>
                          <td>{formatNumberJa(row.bucketCounts.expired)}</td>
                          <td>{formatNumberJa(row.bucketCounts.within30)}</td>
                          <td>{formatNumberJa(row.bucketCounts.within60)}</td>
                          <td>{formatNumberJa(row.bucketCounts.within90)}</td>
                          <td>{formatNumberJa(row.bucketCounts.within120)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AppTable>
                </div>
              )}
              mobile={() => (
                <div className="dl-mobile-data-list">
                  {rows.map((row) => (
                    <AppMobileDataCard
                      key={row.pharmacyId}
                      title={row.pharmacyName}
                      subtitle={`総件数: ${formatCountJa(row.totalItems)}`}
                      fields={[
                        { label: 'リスク', value: row.riskScore.toFixed(1) },
                        { label: '期限切れ', value: formatCountJa(row.bucketCounts.expired) },
                        { label: '30日以内', value: formatCountJa(row.bucketCounts.within30) },
                        { label: '60日以内', value: formatCountJa(row.bucketCounts.within60) },
                        { label: '90日以内', value: formatCountJa(row.bucketCounts.within90) },
                        { label: '120日以内', value: formatCountJa(row.bucketCounts.within120) },
                      ]}
                    />
                  ))}
                </div>
              )}
            />
          )}
          </ScrollArea>
        </>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
