import { useState, useCallback, useMemo } from 'react';
import { Badge, ButtonGroup } from 'react-bootstrap';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import { Link, useNavigate } from 'react-router-dom';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import ConfirmActionModal from '../components/ConfirmActionModal';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useToast } from '../contexts/ToastContext';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
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
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  const [sortByExpiry, setSortByExpiry] = useState(false);

  const fetchDeadStock = useCallback((targetPage: number, signal?: AbortSignal) =>
    api.get<ListResponse>(`/inventory/dead-stock?page=${targetPage}`, { signal }), []);

  const {
    items,
    page,
    setPage,
    totalPages,
    pagination,
    loading,
    error,
    retry,
  } = usePaginatedList<DeadStockItem, ListResponse>(fetchDeadStock, {
    errorMessage: 'デッドストック一覧の取得に失敗しました',
  });
  const total = pagination?.total ?? 0;

  const handleDeleteConfirmed = async () => {
    if (pendingDeleteId === null) return;
    setDeleting(true);
    setActionError('');
    try {
      await api.delete(`/inventory/dead-stock/${pendingDeleteId}`);
      showSuccess('削除しました');
      retry();
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

  const pendingItem = pendingDeleteId === null
    ? null
    : items.find((item) => item.id === pendingDeleteId) ?? null;

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">デッドストックリスト ({total}件)</h4>
        <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
      </div>

      {items.length > 0 && (
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

      {(error || actionError) && (
        <ErrorRetryAlert error={error || actionError || ''} onRetry={error ? () => void retry() : undefined} />
      )}

      <ScrollArea>
      {loading ? (
        <InlineLoader text="デッドストック一覧を読み込み中..." className="text-muted small" />
      ) : items.length === 0 ? (
        <AppEmptyState
          title="デッドストックデータがありません"
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
          )}
        />
      )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

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
