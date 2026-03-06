import { useState } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { Badge } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppModalShell from '../../components/ui/AppModalShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa, formatYen } from '../../utils/formatters';
import { proposalStatusLabel } from '../../utils/proposal-status';
import type { ProposalTimelineEvent } from '../../utils/proposal-timeline';
import ProposalTimeline from '../../components/timeline/ProposalTimeline';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

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

export default function AdminExchangesPage() {
  const {
    items: history,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<ExchangeHistoryItem, HistoryResponse>((targetPage, signal) =>
    api.get<HistoryResponse>(`/admin/history?page=${targetPage}`, { signal }),
    { errorMessage: '交換履歴データの取得に失敗しました' },
  );
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<ProposalComment[]>([]);
  const [commentsError, setCommentsError] = useState('');
  const [timeline, setTimeline] = useState<ProposalTimelineEvent[]>([]);
  const [timelineError, setTimelineError] = useState('');

  const openComments = async (proposalId: number) => {
    setSelectedProposalId(proposalId);
    setCommentModalOpen(true);
    setCommentsLoading(true);
    setComments([]);
    setTimeline([]);
    setCommentsError('');
    setTimelineError('');
    const [commentResult, timelineResult] = await Promise.allSettled([
      api.get<{ data: ProposalComment[] }>(`/admin/exchanges/${proposalId}/comments`),
      api.get<{ data: ProposalTimelineEvent[] }>(`/admin/exchanges/${proposalId}/timeline`),
    ]);

    if (commentResult.status === 'fulfilled') {
      setComments(commentResult.value.data);
    } else {
      setCommentsError(commentResult.reason instanceof Error ? commentResult.reason.message : '交渉メモの取得に失敗しました');
    }

    if (timelineResult.status === 'fulfilled') {
      setTimeline(timelineResult.value.data);
    } else {
      setTimelineError(timelineResult.reason instanceof Error ? timelineResult.reason.message : '進行履歴の取得に失敗しました');
    }

    setCommentsLoading(false);
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">交換履歴（管理者）</h4>
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}
      <ScrollArea>
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
                      <td>{formatDateTimeJa(item.completedAt)}</td>
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
                    { label: '完了日時', value: formatDateTimeJa(item.completedAt) },
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
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <AppModalShell
        show={commentModalOpen}
        onHide={() => setCommentModalOpen(false)}
        title={`交渉メモ（提案ID: ${selectedProposalId ?? '-'}）`}
        size="lg"
      >
        {commentsLoading ? (
          <InlineLoader text="交渉メモを読み込み中..." className="text-muted small" />
        ) : (
          <>
            <div className="mb-3 p-2 border rounded">
              <div className="fw-semibold mb-2">進行履歴</div>
              {timelineError && <AppAlert variant="warning" className="small py-2">{timelineError}</AppAlert>}
              <ProposalTimeline
                events={timeline}
                statusLabelFormatter={proposalStatusLabel}
                filterAriaLabel="管理者向け進行履歴フィルタ"
                emptyMessage="履歴はありません。"
              />
            </div>

            {commentsError && <AppAlert variant="warning" className="small py-2">{commentsError}</AppAlert>}
            {!commentsError && comments.length === 0 ? (
              <div className="small text-muted">交渉メモはありません。</div>
            ) : !commentsError ? (
              <div className="d-flex flex-column gap-2">
                {comments.map((comment) => (
                  <div key={comment.id} className="border rounded p-2">
                    <div className="small text-muted">
                      {comment.authorName} / {formatDateTimeJa(comment.createdAt)}
                    </div>
                    <div>{comment.body}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </AppModalShell>
    </PageShell>
  );
}
