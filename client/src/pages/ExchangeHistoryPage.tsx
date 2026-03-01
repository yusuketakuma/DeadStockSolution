import AppTable from '../components/ui/AppTable';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import AppEmptyState from '../components/ui/AppEmptyState';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import InlineLoader from '../components/ui/InlineLoader';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { Link } from 'react-router-dom';
import { formatDateJa, formatYen } from '../utils/formatters';

interface HistoryItem {
  id: number;
  proposalId: number;
  pharmacyAId: number;
  pharmacyBId: number;
  pharmacyAName: string;
  pharmacyBName: string;
  totalValue: number | null;
  completedAt: string | null;
}

interface HistoryResponse {
  data: HistoryItem[];
  pagination: { page: number; totalPages: number; total: number };
}

function timelineDetailTo(proposalId: number) {
  return {
    pathname: `/proposals/${proposalId}`,
    hash: '#proposal-timeline',
  };
}

export default function ExchangeHistoryPage() {
  const { user } = useAuth();
  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<HistoryItem, HistoryResponse>((targetPage, signal) =>
    api.get<HistoryResponse>(`/exchange/history?page=${targetPage}`, { signal }),
    { errorMessage: '交換履歴の取得に失敗しました' },
  );

  return (
    <div>
      <h4 className="page-title mb-3">交換履歴</h4>
      {error && (
        <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>{error}</span>
          <AppButton size="sm" variant="outline-danger" onClick={() => void retry()}>
            再試行
          </AppButton>
        </AppAlert>
      )}
      {loading ? (
        <InlineLoader text="交換履歴を読み込み中..." className="text-muted small" />
      ) : error ? null : items.length === 0 ? (
        <AppEmptyState
          title="交換履歴はまだありません"
          description="交換完了した履歴がここに表示されます。"
          actionLabel="マッチング一覧へ"
          actionTo="/proposals"
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover>
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>相手薬局</th>
                    <th>合計薬価</th>
                    <th>完了日</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isA = item.pharmacyAId === user?.id;
                    const otherName = isA ? item.pharmacyBName : item.pharmacyAName;

                    return (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{otherName}</td>
                        <td>{formatYen(item.totalValue)}</td>
                        <td>{formatDateJa(item.completedAt, '')}</td>
                        <td>
                          <Link to={timelineDetailTo(item.proposalId)} className="btn btn-sm btn-outline-primary">
                            タイムライン
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {items.map((item) => {
                const isA = item.pharmacyAId === user?.id;
                const otherName = isA ? item.pharmacyBName : item.pharmacyAName;

                return (
                  <AppMobileDataCard
                    key={item.id}
                    title={`履歴 #${item.id}`}
                    subtitle={otherName}
                    fields={[
                      { label: '提案ID', value: item.proposalId },
                      { label: '合計薬価', value: formatYen(item.totalValue) },
                      { label: '完了日', value: formatDateJa(item.completedAt) },
                    ]}
                    actions={<Link to={timelineDetailTo(item.proposalId)} className="btn btn-sm btn-outline-primary w-100">タイムライン</Link>}
                  />
                );
              })}
            </div>
          )}
        />
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
