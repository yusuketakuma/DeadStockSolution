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
import AppDropdownMenu from '../components/ui/AppDropdownMenu';
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
        <div className="dl-page-header-actions mobile-stack">
          <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'quality', to: '/upload-quality', label: '品質を確認' },
              { key: 'matching', to: '/matching', label: '候補を確認' },
              { key: 'dead-stock', to: '/inventory/dead-stock', label: 'デッドストックを確認' },
              { key: 'browse', to: '/inventory/browse', label: '在庫を確認' },
              { key: 'search', to: '/inventory/search', label: '検索条件を確認' },
              { key: 'proposals', to: '/proposals', label: '提案一覧を確認' },
              { key: 'statistics', to: '/statistics', label: '統計を確認' },
            ]}
          />
        </div>
      </div>

      {queryError && (
        <ErrorRetryAlert error={queryError} onRetry={() => void refetch()} />
      )}

      <ScrollArea>
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
