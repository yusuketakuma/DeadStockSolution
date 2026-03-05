import { useState, useEffect, useCallback, useRef } from 'react';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import AppEmptyState from '../components/ui/AppEmptyState';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import SearchInput from '../components/SearchInput';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { usePaginatedList } from '../hooks/usePaginatedList';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

interface BrowseItem {
  id: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  packageLabel?: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  pharmacyName: string;
  prefecture: string;
  businessStatus?: BusinessHoursStatus;
}

interface BrowseResponse {
  data: BrowseItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function InventoryBrowsePage() {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const initializedSearchRef = useRef(false);

  const fetchBrowse = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (search) params.set('search', search);
    return api.get<BrowseResponse>(`/inventory/browse?${params}`, { signal });
  }, [search]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<BrowseItem, BrowseResponse>(fetchBrowse, {
    errorMessage: '在庫データの取得に失敗しました',
  });

  useEffect(() => {
    if (!initializedSearchRef.current) {
      initializedSearchRef.current = true;
      return;
    }
    if (page !== 1) {
      setPage(1);
      return;
    }
    void fetchPage(1);
  }, [fetchPage, page, setPage, search]);

  const handleSearch = (q: string) => {
    setSearch(q);
  };
  return (
    <PageShell>
      <h4 className="page-title mb-3">全薬局の在庫参照</h4>
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}

      <div className="mb-3 d-flex gap-2 mobile-stack">
        <div className="flex-grow-1">
          <SearchInput
            placeholder="薬品名で検索（ひらがな・カタカナ対応）..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={handleSearch}
            suggestUrl="/search/drugs"
          />
        </div>
        <AppButton variant="primary" onClick={() => handleSearch(searchInput)}>検索</AppButton>
        {search && (
          <AppButton variant="outline-secondary" onClick={() => { setSearch(''); setSearchInput(''); }}>
            クリア
          </AppButton>
        )}
      </div>

      <ScrollArea>
      {loading ? (
        <InlineLoader text="在庫データを読み込み中..." className="text-muted small" />
      ) : items.length === 0 ? (
        <AppEmptyState
          title={search ? `「${search}」に一致する在庫が見つかりません` : '在庫データがありません'}
          description={search ? '検索条件を変えて再度お試しください。' : '在庫データが登録されると表示されます。'}
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm" className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>薬品名</th>
                    <th>数量</th>
                    <th>単位</th>
                    <th>包装</th>
                    <th>薬価(単価)</th>
                    <th>薬価(合計)</th>
                    <th>使用期限</th>
                    <th>薬局名</th>
                    <th>都道府県</th>
                    <th>営業状況</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.drugName}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>{item.packageLabel || '-'}</td>
                      <td>{item.yakkaUnitPrice?.toLocaleString()}</td>
                      <td>{item.yakkaTotal?.toLocaleString()}</td>
                      <td>{item.expirationDate}</td>
                      <td>{item.pharmacyName}</td>
                      <td>{item.prefecture}</td>
                      <td><BusinessStatusBadge status={item.businessStatus} fallback="dash" /></td>
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
                  subtitle={`${item.pharmacyName}（${item.prefecture}）`}
                  badges={<BusinessStatusBadge status={item.businessStatus} fallback="dash" />}
                  fields={[
                    { label: '数量', value: item.quantity },
                    { label: '単位', value: item.unit || '-' },
                    { label: '包装', value: item.packageLabel || '-' },
                    { label: '薬価(単価)', value: item.yakkaUnitPrice?.toLocaleString() ?? '-' },
                    { label: '薬価(合計)', value: item.yakkaTotal?.toLocaleString() ?? '-' },
                    { label: '使用期限', value: item.expirationDate || '-' },
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
