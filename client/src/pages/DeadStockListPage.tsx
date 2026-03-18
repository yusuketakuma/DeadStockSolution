import { useState, useMemo, useEffect, useCallback } from 'react';
import { Badge, ButtonGroup, Form } from 'react-bootstrap';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import ConfirmActionModal from '../components/ConfirmActionModal';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import SearchInput from '../components/SearchInput';
import SearchChips from '../components/search/SearchChips';
import SearchResultStatus from '../components/search/SearchResultStatus';
import { useIncrementalSearch } from '../hooks/useIncrementalSearch';
import { useToast } from '../contexts/ToastContext';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import PullToRefresh from '../components/gesture/PullToRefresh';
import MobileFilterSheet from '../components/mobile/MobileFilterSheet';
import { daysUntilExpiry, resolveBucket, bucketVariant, formatDaysRemaining, type RiskBucket } from '../utils/expiry-risk';

interface DeadStockItem {
  id: number;
  drugName: string;
  drugCode: string | null;
  quantity: number;
  unit: string | null;
  packageLabel?: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
  isAvailable: boolean;
}

interface ListResponse {
  data: DeadStockItem[];
  pagination: { page: number; totalPages: number; total: number };
}

type ExpiryFilter = 'all' | 'expired' | 'within30' | 'within60' | 'within90';

const EXPIRY_FILTER_LABELS: Record<ExpiryFilter, string> = {
  all: 'すべて',
  expired: '期限切れ',
  within30: '30日以内',
  within60: '60日以内',
  within90: '90日以内',
};

const EXPIRY_FILTER_BUCKETS: Record<Exclude<ExpiryFilter, 'all'>, RiskBucket[]> = {
  expired: ['expired'],
  within30: ['expired', 'within30'],
  within60: ['expired', 'within30', 'within60'],
  within90: ['expired', 'within30', 'within60', 'within90'],
};

interface EnrichedItem extends DeadStockItem {
  daysRemaining: number | null;
  bucket: RiskBucket;
}

export default function DeadStockListPage() {
  const { showSuccess } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  const [sortByExpiry, setSortByExpiry] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [totalPages, setTotalPages] = useState(1);

  const initialQuery = searchParams.get('search') || '';

  const fetchDeadStock = useCallback(
    async (query: string, page: number, signal: AbortSignal) => {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set('search', query);
      const res = await api.get<ListResponse>(`/inventory/dead-stock?${params}`, { signal });
      setTotalPages(res.pagination.totalPages);
      return { data: res.data, total: res.pagination.total };
    },
    [],
  );

  const incrementalSearch = useIncrementalSearch<DeadStockItem>({
    fetchFn: fetchDeadStock,
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

  // 初回フェッチ（minChars=0 なので空クエリでもフェッチする）
  useEffect(() => {
    incrementalSearch.executeImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = incrementalSearch.results;
  const total = incrementalSearch.total;

  const handleDeleteConfirmed = async () => {
    if (pendingDeleteId === null) return;
    setDeleting(true);
    setActionError('');
    try {
      await api.delete(`/inventory/dead-stock/${pendingDeleteId}`);
      showSuccess('削除しました');
      incrementalSearch.executeImmediate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const enrichedItems = useMemo<EnrichedItem[]>(() =>
    items.map((item) => {
      const days = daysUntilExpiry(item.expirationDate);
      return { ...item, daysRemaining: days, bucket: resolveBucket(days) };
    }), [items]);

  const displayItems = useMemo(() => {
    let filtered = enrichedItems;
    if (expiryFilter !== 'all') {
      const matchBuckets = EXPIRY_FILTER_BUCKETS[expiryFilter];
      filtered = filtered.filter((item) => matchBuckets.includes(item.bucket));
    }
    if (sortByExpiry) {
      filtered = [...filtered].sort((a, b) => {
        if (a.daysRemaining === null && b.daysRemaining === null) return 0;
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
        return a.daysRemaining - b.daysRemaining;
      });
    }
    return filtered;
  }, [enrichedItems, expiryFilter, sortByExpiry]);

  const handleRemoveToken = (token: string) => {
    const newTokens = incrementalSearch.tokens.filter((t) => t !== token);
    incrementalSearch.setQuery(newTokens.join(' '));
  };

  const pendingItem = pendingDeleteId === null
    ? null
    : items.find((item) => item.id === pendingDeleteId) ?? null;

  const resultsStyle = {
    opacity: incrementalSearch.isSearching ? 0.6 : 1,
    transition: 'opacity 0.2s',
  };

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">デッドストックリスト ({total}件)</h4>
        <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
      </div>

      <div className="mb-2">
        <SearchInput
          placeholder="薬品名で検索（スペース区切りで絞り込み）..."
          value={incrementalSearch.query}
          onChange={incrementalSearch.setQuery}
          onSearch={() => incrementalSearch.executeImmediate()}
          suggestUrl="/search/drugs"
        />
        <div className="mt-1">
          <SearchChips
            tokens={incrementalSearch.tokens}
            onRemove={handleRemoveToken}
            maxTokenWarning={incrementalSearch.tokens.length > 5}
          />
        </div>
      </div>

      <div className="mb-2">
        <SearchResultStatus
          totalCount={total}
          isSearching={incrementalSearch.isSearching}
          searchQuery={incrementalSearch.query}
        />
      </div>

      {items.length > 0 && (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
              <ButtonGroup size="sm">
                {(Object.keys(EXPIRY_FILTER_LABELS) as ExpiryFilter[]).map((key) => (
                  <AppButton
                    key={key}
                    variant={expiryFilter === key ? 'primary' : 'outline-primary'}
                    onClick={() => setExpiryFilter(key)}
                  >
                    {EXPIRY_FILTER_LABELS[key]}
                  </AppButton>
                ))}
              </ButtonGroup>
              <AppButton
                size="sm"
                variant={sortByExpiry ? 'secondary' : 'outline-secondary'}
                onClick={() => setSortByExpiry((v) => !v)}
              >
                期限順
              </AppButton>
            </div>
          )}
          mobile={() => (
            <div className="d-flex align-items-center gap-2 mb-2">
              <AppButton
                size="sm"
                variant="outline-secondary"
                onClick={() => setFilterSheetOpen(true)}
              >
                <i className="bi bi-funnel" />{' '}
                フィルタ
                {(expiryFilter !== 'all' || sortByExpiry) && (
                  <Badge bg="primary" pill className="ms-1">
                    {(expiryFilter !== 'all' ? 1 : 0) + (sortByExpiry ? 1 : 0)}
                  </Badge>
                )}
              </AppButton>
            </div>
          )}
        />
      )}

      <MobileFilterSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="期限フィルタ"
        activeFilterCount={(expiryFilter !== 'all' ? 1 : 0) + (sortByExpiry ? 1 : 0)}
        onReset={() => {
          setExpiryFilter('all');
          setSortByExpiry(false);
        }}
        onApply={() => {/* filters already applied via state */}}
      >
        <Form.Group className="mb-3">
          <Form.Label className="fw-semibold small">使用期限</Form.Label>
          {(Object.keys(EXPIRY_FILTER_LABELS) as ExpiryFilter[]).map((key) => (
            <Form.Check
              key={key}
              type="radio"
              id={`expiry-filter-${key}`}
              name="expiryFilter"
              label={EXPIRY_FILTER_LABELS[key]}
              checked={expiryFilter === key}
              onChange={() => setExpiryFilter(key)}
            />
          ))}
        </Form.Group>
        <Form.Group>
          <Form.Check
            type="switch"
            id="sort-by-expiry"
            label="期限順に並べ替え"
            checked={sortByExpiry}
            onChange={() => setSortByExpiry((v) => !v)}
          />
        </Form.Group>
      </MobileFilterSheet>

      {actionError && (
        <ErrorRetryAlert error={actionError} />
      )}

      <ScrollArea>
      <div style={resultsStyle}>
      {incrementalSearch.isSearching && items.length === 0 ? (
        <InlineLoader text="デッドストック一覧を読み込み中..." className="text-muted small" />
      ) : items.length === 0 ? (
        <AppEmptyState
          title={incrementalSearch.query ? `「${incrementalSearch.query}」に一致するデータがありません` : 'デッドストックデータがありません'}
          description={incrementalSearch.query ? '検索条件を変えて再度お試しください。' : 'Excelファイルをアップロードすると一覧に表示されます。'}
          actionLabel={incrementalSearch.query ? undefined : 'アップロードへ進む'}
          actionTo={incrementalSearch.query ? undefined : '/upload'}
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
                    <th>数量</th>
                    <th>単位</th>
                    <th>包装</th>
                    <th>薬価(単価)</th>
                    <th>薬価(合計)</th>
                    <th>使用期限</th>
                    <th>残り日数</th>
                    <th>ロット</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.drugName}</td>
                      <td className="small text-muted">{item.drugCode}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>{item.packageLabel || '-'}</td>
                      <td>{item.yakkaUnitPrice?.toLocaleString()}</td>
                      <td>{item.yakkaTotal?.toLocaleString()}</td>
                      <td>{item.expirationDate}</td>
                      <td>
                        <Badge bg={bucketVariant(item.bucket)}>{formatDaysRemaining(item.daysRemaining)}</Badge>
                      </td>
                      <td className="small">{item.lotNumber}</td>
                      <td className="d-flex gap-1">
                        <AppButton
                          size="sm"
                          variant="outline-primary"
                          onClick={() => navigate(`/matching?drug=${encodeURIComponent(item.drugName)}`)}
                        >
                          候補検索
                        </AppButton>
                        <AppButton size="sm" variant="outline-danger" onClick={() => setPendingDeleteId(item.id)}>
                          削除
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <PullToRefresh disabled={filterSheetOpen} onRefresh={() => { incrementalSearch.executeImmediate(); return new Promise(r => setTimeout(r, 300)); }}>
            <div className="dl-mobile-data-list">
              {displayItems.map((item) => (
                <AppMobileDataCard
                  key={item.id}
                  title={item.drugName}
                  subtitle={item.drugCode || '-'}
                  fields={[
                    { label: '数量', value: item.quantity },
                    { label: '単位', value: item.unit || '-' },
                    { label: '包装', value: item.packageLabel || '-' },
                    { label: '薬価(単価)', value: item.yakkaUnitPrice?.toLocaleString() ?? '-' },
                    { label: '薬価(合計)', value: item.yakkaTotal?.toLocaleString() ?? '-' },
                    { label: '使用期限', value: item.expirationDate || '-' },
                    { label: '残り日数', value: formatDaysRemaining(item.daysRemaining) },
                    { label: 'ロット', value: item.lotNumber || '-' },
                  ]}
                  actions={(
                    <div className="d-flex gap-1">
                      <AppButton
                        size="sm"
                        variant="outline-primary"
                        onClick={() => navigate(`/matching?drug=${encodeURIComponent(item.drugName)}`)}
                      >
                        候補検索
                      </AppButton>
                      <AppButton size="sm" variant="outline-danger" onClick={() => setPendingDeleteId(item.id)}>
                        削除
                      </AppButton>
                    </div>
                  )}
                />
              ))}
            </div>
            </PullToRefresh>
          )}
        />
      )}
      </div>
      </ScrollArea>
      <Pagination currentPage={incrementalSearch.page} totalPages={totalPages} onPageChange={incrementalSearch.setPage} />

      <ConfirmActionModal
        show={pendingDeleteId !== null}
        title="デッドストックデータの削除"
        body={pendingItem
          ? `「${pendingItem.drugName}」をデッドストックリストから削除します。よろしいですか？`
          : 'このデッドストックデータを削除します。よろしいですか？'}
        confirmLabel="削除する"
        confirmVariant="danger"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={handleDeleteConfirmed}
        pending={deleting}
      />
    </PageShell>
  );
}
