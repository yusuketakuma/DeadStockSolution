import { useState } from 'react';
import AppTable from '../components/ui/AppTable';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import { useApiQuery } from '../hooks/useApiQuery';
import { Link } from 'react-router-dom';
import { formatDateJa, formatYen } from '../utils/formatters';
import AppDataTable from '../components/ui/AppDataTable';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import ProposalNavigationLinks, { type ProposalNavigationLinkGroup } from '../components/proposal/ProposalNavigationLinks';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';

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

const EXCHANGE_HISTORY_LINK_GROUPS: readonly ProposalNavigationLinkGroup[] = [
  {
    title: '履歴と提案',
    description: '完了後でも提案詳細や一覧に戻れます。',
    links: [
      { to: '/proposals', label: '提案一覧を確認' },
      { to: '/matching', label: '候補を確認' },
      { to: '/messages', label: 'メッセージを確認' },
    ],
  },
  {
    title: '次の確認',
    description: '次の交換候補や通知確認へ進めます。',
    links: [
      { to: '/notifications', label: '通知を確認' },
      { to: '/bookmarks', label: 'ブックマークを確認' },
    ],
  },
] as const;

export default function ExchangeHistoryPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const {
    data,
    isLoading: loading,
    error,
    refetch,
  } = useApiQuery(
    ['exchange-history', page],
    ({ signal }) => api.get<HistoryResponse>(`/exchange/history?page=${page}`, { signal }),
  );

  const items = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;
  const queryError = error instanceof Error ? error.message : '';

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">交換履歴</h4>
          <div className="text-muted small">完了した交換から提案タイムラインや関連メッセージへ戻れます。</div>
        </div>
        <div className="dl-page-header-actions mobile-stack">
          <Link to="/matching" className="btn btn-primary btn-sm">候補を確認</Link>
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'proposals', to: '/proposals', label: '提案一覧を確認' },
              { key: 'messages', to: '/messages', label: 'メッセージを確認' },
            ]}
          />
        </div>
      </div>
      <ScrollArea>
      <ProposalNavigationLinks groups={EXCHANGE_HISTORY_LINK_GROUPS} />
      <AppDataTable
        loading={loading}
        error={queryError}
        onRetry={() => void refetch()}
        loadingText="交換履歴を読み込み中..."
        isEmpty={items.length === 0}
        emptyTitle="交換履歴はまだありません"
        emptyDescription="交換完了した履歴がここに表示されます。マッチング一覧や通知確認に戻れます。"
        emptyActionLabel="提案一覧を確認"
        emptyActionTo="/proposals"
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
                        <div className="dl-action-row mobile-stack">
                          <Link to={timelineDetailTo(item.proposalId)} className="btn btn-sm btn-outline-primary">
                            タイムライン
                          </Link>
                          <AppDropdownMenu
                            label="その他"
                            size="sm"
                            variant="outline-secondary"
                            items={[
                              {
                                label: '印刷',
                                to: `/proposals/${item.proposalId}/print`,
                                target: '_blank',
                                rel: 'noopener noreferrer',
                              },
                            ]}
                          />
                        </div>
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
                  actions={(
                    <div className="dl-action-row mobile-stack">
                      <Link to={timelineDetailTo(item.proposalId)} className="btn btn-sm btn-outline-primary">タイムライン</Link>
                      <AppDropdownMenu
                        label="その他"
                        size="sm"
                        variant="outline-secondary"
                        items={[
                          {
                            label: '印刷',
                            to: `/proposals/${item.proposalId}/print`,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                          },
                        ]}
                      />
                    </div>
                  )}
                />
              );
            })}
          </div>
        )}
      />
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
