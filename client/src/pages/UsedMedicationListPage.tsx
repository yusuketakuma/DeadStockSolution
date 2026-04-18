import { useState } from 'react';
import AppTable from '../components/ui/AppTable';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppDataPanel from '../components/ui/AppDataPanel';
import { useApiQuery } from '../hooks/useApiQuery';
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
  const [page, setPage] = useState(1);
  const {
    data,
    isLoading: loading,
    error,
    refetch,
  } = useApiQuery(
    ['used-medication-list', page],
    ({ signal }) => api.get<ListResponse>(`/inventory/used-medication?page=${page}`, { signal }),
  );

  const items = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;
  const total = data?.pagination.total ?? 0;
  const queryError = error instanceof Error ? error.message : '';

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">医薬品使用量リスト ({total}件)</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
          <Link to="/upload-quality" className="btn btn-outline-danger btn-sm">品質を確認</Link>
          <Link to="/matching" className="btn btn-outline-primary btn-sm">候補を確認</Link>
        </div>
      </div>

      <AppDataPanel title="関連画面" className="mb-2">
        <div className="d-flex gap-2 flex-wrap align-items-center">
          <Link to="/inventory/dead-stock" className="btn btn-outline-secondary btn-sm">デッドストックを確認</Link>
          <Link to="/inventory/browse" className="btn btn-outline-secondary btn-sm">在庫を確認</Link>
          <Link to="/inventory/search" className="btn btn-outline-secondary btn-sm">検索条件を確認</Link>
          <Link to="/statistics" className="btn btn-outline-secondary btn-sm">統計を確認</Link>
          <span className="small text-muted">需要確認後に在庫比較や統計へすぐ戻れます。</span>
        </div>
      </AppDataPanel>

      {queryError && (
        <ErrorRetryAlert error={queryError} onRetry={() => void refetch()} />
      )}

      <ScrollArea>
      <AppDataPanel title="次にやること" className="mb-3">
        <div className="d-flex gap-2 flex-wrap">
          <Link to="/matching" className="btn btn-outline-primary btn-sm">候補を確認</Link>
          <Link to="/proposals" className="btn btn-outline-secondary btn-sm">提案一覧を確認</Link>
          <Link to="/statistics" className="btn btn-outline-secondary btn-sm">統計を確認</Link>
        </div>
        <div className="small text-muted mt-2">
          使用量更新後は、候補確認と提案状況の確認へ進めます。
        </div>
      </AppDataPanel>

      {loading ? (
        <InlineLoader text="医薬品使用量一覧を読み込み中..." className="text-muted small" />
      ) : queryError ? null : items.length === 0 ? (
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
