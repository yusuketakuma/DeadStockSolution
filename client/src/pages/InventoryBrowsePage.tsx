import { useState, useEffect } from 'react';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import AppEmptyState from '../components/ui/AppEmptyState';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import SearchInput from '../components/SearchInput';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';

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
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async (p: number, q: string) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set('search', q);
    try {
      const data = await api.get<BrowseResponse>(`/inventory/browse?${params}`);
      setItems(data.data);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : '在庫データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(page, search); }, [page, search]);

  const handleSearch = (q: string) => {
    setPage(1);
    setSearch(q);
  };

  return (
    <div>
      <h4 className="page-title mb-3">全薬局の在庫参照</h4>
      {error && (
        <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>{error}</span>
          <AppButton size="sm" variant="outline-danger" onClick={() => void fetchData(page, search)}>
            再試行
          </AppButton>
        </AppAlert>
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
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
