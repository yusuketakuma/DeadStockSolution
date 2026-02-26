import { useEffect, useState } from 'react';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppTable from '../../components/ui/AppTable';
import AppKpiCard from '../../components/ui/AppKpiCard';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import InlineLoader from '../../components/ui/InlineLoader';
import Pagination from '../../components/Pagination';
import { api } from '../../api/client';

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
  const [rows, setRows] = useState<PharmacyRiskSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async (targetPage: number) => {
    setLoading(true);
    setError('');
    try {
      const [overviewData, listData] = await Promise.all([
        api.get<RiskOverview>('/admin/risk/overview'),
        api.get<RiskListResponse>(`/admin/risk/pharmacies?page=${targetPage}`),
      ]);
      setOverview(overviewData);
      setRows(listData.data);
      setTotalPages(listData.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : '期限リスクデータの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(page);
  }, [page]);

  return (
    <div>
      <h4 className="page-title mb-3">期限切れリスク分析</h4>
      {error && (
        <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>{error}</span>
          <AppButton size="sm" variant="outline-danger" onClick={() => void fetchData(page)}>
            再試行
          </AppButton>
        </AppAlert>
      )}

      {loading && !overview ? (
        <InlineLoader text="リスク分析データを読み込み中..." className="text-muted small" />
      ) : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <AppKpiCard value={overview?.totalPharmacies ?? '-'} label="対象薬局数" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={overview?.highRiskPharmacies ?? '-'} label="高リスク薬局" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={overview?.mediumRiskPharmacies ?? '-'} label="中リスク薬局" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={overview?.avgRiskScore ?? '-'} label="平均リスクスコア" />
            </div>
          </div>

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
                          <td>{row.totalItems}</td>
                          <td className={getRiskBadgeClass(row.riskScore)}>{row.riskScore.toFixed(1)}</td>
                          <td>{row.bucketCounts.expired}</td>
                          <td>{row.bucketCounts.within30}</td>
                          <td>{row.bucketCounts.within60}</td>
                          <td>{row.bucketCounts.within90}</td>
                          <td>{row.bucketCounts.within120}</td>
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
                      subtitle={`総件数: ${row.totalItems}`}
                      fields={[
                        { label: 'リスク', value: row.riskScore.toFixed(1) },
                        { label: '期限切れ', value: row.bucketCounts.expired },
                        { label: '30日以内', value: row.bucketCounts.within30 },
                        { label: '60日以内', value: row.bucketCounts.within60 },
                        { label: '90日以内', value: row.bucketCounts.within90 },
                        { label: '120日以内', value: row.bucketCounts.within120 },
                      ]}
                    />
                  ))}
                </div>
              )}
            />
          )}
        </>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
