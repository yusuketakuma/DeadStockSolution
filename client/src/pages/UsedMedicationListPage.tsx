import AppTable from '../components/ui/AppTable';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { usePaginatedList } from '../hooks/usePaginatedList';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

interface UsedMedicationItem {
  id: number;
  drugName: string;
  drugCode: string | null;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface ListResponse {
  data: UsedMedicationItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function UsedMedicationListPage() {
  const {
    items,
    page,
    setPage,
    totalPages,
    pagination,
    loading,
    error,
    retry,
  } = usePaginatedList<UsedMedicationItem, ListResponse>((targetPage, signal) =>
    api.get<ListResponse>(`/inventory/used-medication?page=${targetPage}`, { signal }),
    { errorMessage: '医薬品使用量一覧の取得に失敗しました' },
  );

  const total = pagination?.total ?? 0;

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">医薬品使用量リスト ({total}件)</h4>
        <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
      </div>

      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}

      <ScrollArea>
      {loading ? (
        <InlineLoader text="医薬品使用量一覧を読み込み中..." className="text-muted small" />
      ) : error ? null : items.length === 0 ? (
        <AppEmptyState
          title="医薬品使用量データがありません"
          description="Excelファイルをアップロードすると一覧に表示されます。"
          actionLabel="アップロードへ進む"
          actionTo="/upload"
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm">
                <thead className="table-light">
                  <tr>
                    <th>薬品名</th>
                    <th>コード</th>
                    <th>月間使用量</th>
                    <th>単位</th>
                    <th>薬価(単価)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.drugName}</td>
                      <td className="small text-muted">{item.drugCode}</td>
                      <td>{item.monthlyUsage}</td>
                      <td>{item.unit}</td>
                      <td>{item.yakkaUnitPrice?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {items.map((item) => (
                <AppMobileDataCard
                  key={item.id}
                  title={item.drugName}
                  subtitle={item.drugCode || '-'}
                  fields={[
                    { label: '月間使用量', value: item.monthlyUsage ?? '-' },
                    { label: '単位', value: item.unit || '-' },
                    { label: '薬価(単価)', value: item.yakkaUnitPrice?.toLocaleString() ?? '-' },
                  ]}
                />
              ))}
            </div>
          )}
        />
      )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
