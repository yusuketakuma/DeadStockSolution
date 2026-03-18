import { useEffect, useCallback } from 'react';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import AppEmptyState from '../components/ui/AppEmptyState';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import SearchInput from '../components/SearchInput';
import SearchChips from '../components/search/SearchChips';
import SearchResultStatus from '../components/search/SearchResultStatus';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { useIncrementalSearch } from '../hooks/useIncrementalSearch';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useSearchParams } from 'react-router-dom';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('search') || '';

  const fetchBrowse = useCallback(
    async (query: string, page: number, signal: AbortSignal) => {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set('search', query);
      const res = await api.get<BrowseResponse>(`/inventory/browse?${params}`, { signal });
      return { data: res.data, total: res.pagination.total };
    },
    [],
  );

  const incrementalSearch = useIncrementalSearch<BrowseItem>({
    fetchFn: fetchBrowse,
    minChars: 0,
    initialQuery,
  });

  // URL同期
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (incrementalSearch.query) {
      params.set('search', incrementalSearch.query);
    } else {
      params.delete('search');
    }
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incrementalSearch.query]);

  // 初回フェッチ
  useEffect(() => {
    incrementalSearch.executeImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = incrementalSearch.results;
  const total = incrementalSearch.total;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const handleRemoveToken = (token: string) => {
    const newTokens = incrementalSearch.tokens.filter((t) => t !== token);
    incrementalSearch.setQuery(newTokens.join(' '));
  };

  const resultsStyle = {
    opacity: incrementalSearch.isSearching ? 0.6 : 1,
    transition: 'opacity 0.2s',
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">全薬局の在庫参照</h4>

      <div className="mb-2 d-flex gap-2 mobile-stack">
        <div className="flex-grow-1">
          <SearchInput
            placeholder="薬品名で検索（ひらがな・カタカナ対応）..."
            value={incrementalSearch.query}
            onChange={incrementalSearch.setQuery}
            onSearch={() => incrementalSearch.executeImmediate()}
            suggestUrl="/search/drugs"
          />
        </div>
        <AppButton variant="primary" onClick={() => incrementalSearch.executeImmediate()}>検索</AppButton>
        {incrementalSearch.query && (
          <AppButton variant="outline-secondary" onClick={() => incrementalSearch.clear()}>
            クリア
          </AppButton>
        )}
      </div>

      <div className="mb-1">
        <SearchChips
          tokens={incrementalSearch.tokens}
          onRemove={handleRemoveToken}
          maxTokenWarning={incrementalSearch.tokens.length > 5}
        />
      </div>

      <div className="mb-2">
        <SearchResultStatus
          totalCount={total}
          isSearching={incrementalSearch.isSearching}
          searchQuery={incrementalSearch.query}
        />
      </div>

      <ScrollArea>
      <div style={resultsStyle}>
      {incrementalSearch.isSearching && items.length === 0 ? (
        <InlineLoader text="在庫データを読み込み中..." className="text-muted small" />
      ) : items.length === 0 ? (
        <AppEmptyState
          title={incrementalSearch.query ? `「${incrementalSearch.query}」に一致する在庫が見つかりません` : '在庫データがありません'}
          description={incrementalSearch.query ? '検索条件を変えて再度お試しください。' : '在庫データが登録されると表示されます。'}
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
      </div>
      </ScrollArea>
      <Pagination currentPage={incrementalSearch.page} totalPages={totalPages} onPageChange={incrementalSearch.setPage} />
    </PageShell>
  );
}
