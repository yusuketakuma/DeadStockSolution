import { useState, useEffect } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { Badge } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppModalShell from '../../components/ui/AppModalShell';

interface ExchangeHistoryItem {
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
  data: ExchangeHistoryItem[];
  pagination: { page: number; totalPages: number; total: number };
}

interface ProposalComment {
  id: number;
  authorName: string;
  body: string;
  createdAt: string | null;
}

function formatYen(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value.toLocaleString()}円`;
}

export default function AdminExchangesPage() {
  const [history, setHistory] = useState<ExchangeHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<ProposalComment[]>([]);
  const [commentsError, setCommentsError] = useState('');

  const fetchData = async (targetPage: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<HistoryResponse>(`/admin/history?page=${targetPage}`);
      setHistory(data.data);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : '交換履歴データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(page);
  }, [page]);

  const openComments = async (proposalId: number) => {
    setSelectedProposalId(proposalId);
    setCommentModalOpen(true);
    setCommentsLoading(true);
    setCommentsError('');
    try {
      const result = await api.get<{ data: ProposalComment[] }>(`/admin/exchanges/${proposalId}/comments`);
      setComments(result.data);
    } catch (err) {
      setComments([]);
      setCommentsError(err instanceof Error ? err.message : '交渉メモの取得に失敗しました');
    } finally {
      setCommentsLoading(false);
    }
  };

  return (
    <div>
      <h4 className="page-title mb-3">交換履歴（管理者）</h4>
      {error && (
        <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>{error}</span>
          <AppButton size="sm" variant="outline-danger" onClick={() => void fetchData(page)}>
            再試行
          </AppButton>
        </AppAlert>
      )}
      {loading ? (
        <InlineLoader text="交換履歴データを読み込み中..." className="text-muted small" />
      ) : history.length === 0 ? (
        <AppEmptyState
          title="交換履歴データがありません"
          description="交換完了データが登録されると表示されます。"
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>履歴ID</th>
                    <th>提案ID</th>
                    <th>薬局A</th>
                    <th>薬局B</th>
                    <th>交換金額</th>
                    <th>完了日時</th>
                    <th>状態</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.proposalId}</td>
                      <td>{item.pharmacyAName} (ID:{item.pharmacyAId})</td>
                      <td>{item.pharmacyBName} (ID:{item.pharmacyBId})</td>
                      <td>{formatYen(item.totalValue)}</td>
                      <td>{item.completedAt ? new Date(item.completedAt).toLocaleString('ja-JP') : '-'}</td>
                      <td><Badge bg="secondary">完了</Badge></td>
                      <td>
                        <AppButton size="sm" variant="outline-primary" onClick={() => void openComments(item.proposalId)}>
                          交渉メモ
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
              {history.map((item) => (
                <AppMobileDataCard
                  key={item.id}
                  title={`履歴ID: ${item.id}`}
                  subtitle={`提案ID: ${item.proposalId}`}
                  badges={<Badge bg="secondary">完了</Badge>}
                  fields={[
                    { label: '薬局A', value: `${item.pharmacyAName} (ID:${item.pharmacyAId})` },
                    { label: '薬局B', value: `${item.pharmacyBName} (ID:${item.pharmacyBId})` },
                    { label: '交換金額', value: formatYen(item.totalValue) },
                    { label: '完了日時', value: item.completedAt ? new Date(item.completedAt).toLocaleString('ja-JP') : '-' },
                  ]}
                  actions={(
                    <AppButton size="sm" variant="outline-primary" onClick={() => void openComments(item.proposalId)}>
                      交渉メモ
                    </AppButton>
                  )}
                />
              ))}
            </div>
          )}
        />
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <AppModalShell
        show={commentModalOpen}
        onHide={() => setCommentModalOpen(false)}
        title={`交渉メモ（提案ID: ${selectedProposalId ?? '-'}）`}
        size="lg"
      >
        {commentsError && <AppAlert variant="danger">{commentsError}</AppAlert>}
        {commentsLoading ? (
          <InlineLoader text="交渉メモを読み込み中..." className="text-muted small" />
        ) : comments.length === 0 ? (
          <div className="small text-muted">交渉メモはありません。</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {comments.map((comment) => (
              <div key={comment.id} className="border rounded p-2">
                <div className="small text-muted">
                  {comment.authorName} / {comment.createdAt ? new Date(comment.createdAt).toLocaleString('ja-JP') : '-'}
                </div>
                <div>{comment.body}</div>
              </div>
            ))}
          </div>
        )}
      </AppModalShell>
    </div>
  );
}
