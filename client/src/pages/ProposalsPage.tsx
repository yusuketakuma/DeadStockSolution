import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppTable from '../components/ui/AppTable';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import LoadingButton from '../components/ui/LoadingButton';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import { Badge, FormCheck } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import { usePaginatedList } from '../hooks/usePaginatedList';
import AppSelect from '../components/ui/AppSelect';
import { formatDateTimeJa, formatYen } from '../utils/formatters';
import { proposalStatusStyle } from '../utils/proposal-status';
import AppActionBar from '../components/ui/AppActionBar';
import AppDataTable from '../components/ui/AppDataTable';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

interface Proposal {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  pharmacyAName: string;
  pharmacyBName: string;
  status: string;
  totalValueA: number | null;
  totalValueB: number | null;
  valueDifference: number | null;
  proposedAt: string | null;
  deadlineAt?: string | null;
  priorityScore?: number;
  priorityReasons?: string[];
}

interface ProposalsResponse {
  data: Proposal[];
  pagination: { page: number; totalPages: number; total: number };
}

interface BulkActionResponse {
  summary: {
    total: number;
    success: number;
    failed: number;
  };
}

type ProposalSortMode = 'recent' | 'priority';


function canAcceptProposal(proposal: Proposal, viewerId: number | undefined): boolean {
  if (!viewerId) return false;
  const isA = proposal.pharmacyAId === viewerId;
  return proposal.status === 'proposed'
    || (proposal.status === 'accepted_a' && !isA)
    || (proposal.status === 'accepted_b' && isA);
}

function canRejectProposal(proposal: Proposal): boolean {
  return ['proposed', 'accepted_a', 'accepted_b'].includes(proposal.status);
}

export default function ProposalsPage() {
  const { user } = useAuth();
  const [sortMode, setSortMode] = useState<ProposalSortMode>('recent');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState<'accept' | 'reject' | null>(null);
  const [message, setMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const initializedSortRef = useRef(false);

  const fetchProposals = useCallback((targetPage: number, signal?: AbortSignal) => (
    api.get<ProposalsResponse>(`/exchange/proposals?page=${targetPage}&sort=${sortMode}`, { signal })
  ), [sortMode]);

  const {
    items: proposals,
    page,
    setPage,
    totalPages,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<Proposal, ProposalsResponse>(fetchProposals,
    { errorMessage: 'マッチング一覧の取得に失敗しました' },
  );

  useEffect(() => {
    setSelectedIds([]);
  }, [proposals]);

  useEffect(() => {
    if (!initializedSortRef.current) {
      initializedSortRef.current = true;
      return;
    }

    setSelectedIds([]);
    if (page !== 1) {
      setPage(1);
      return;
    }
    void fetchPage(1);
  }, [fetchPage, page, setPage, sortMode]);

  const actionableIds = useMemo(() => {
    const viewerId = user?.id;
    return proposals
      .filter((proposal) => canAcceptProposal(proposal, viewerId) || canRejectProposal(proposal))
      .map((proposal) => proposal.id);
  }, [proposals, user?.id]);
  const actionableIdSet = useMemo(() => new Set(actionableIds), [actionableIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const allSelected = actionableIds.length > 0 && actionableIds.every((id) => selectedIdSet.has(id));

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (allSelected
      ? prev.filter((id) => !actionableIdSet.has(id))
      : [...new Set([...prev, ...actionableIds])]));
  };

  const handleBulkAction = async (action: 'accept' | 'reject') => {
    if (selectedIds.length === 0) {
      setBulkError('対象を選択してください');
      return;
    }

    const confirmed = window.confirm(`選択中の${selectedIds.length}件を${action === 'accept' ? '承認' : '拒否'}します。よろしいですか？`);
    if (!confirmed) return;

    setBulkActionLoading(action);
    setBulkError('');
    setMessage('');
    try {
      const result = await api.post<BulkActionResponse>('/exchange/proposals/bulk-action', {
        action,
        ids: selectedIds,
      });
      setMessage(`一括${action === 'accept' ? '承認' : '拒否'}: 成功 ${result.summary.success} / 失敗 ${result.summary.failed}`);
      setSelectedIds([]);
      await retry();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : '一括操作に失敗しました');
    } finally {
      setBulkActionLoading(null);
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">マッチング一覧</h4>
      {bulkError && <AppAlert variant="danger">{bulkError}</AppAlert>}
      {message && <AppAlert variant="success">{message}</AppAlert>}

      <AppActionBar
        className="mb-3"
        leading={(
          <div style={{ minWidth: 180 }}>
            <AppSelect
              controlId="proposal-sort-mode"
              value={sortMode}
              ariaLabel="並び順"
              onChange={(value) => setSortMode(value as ProposalSortMode)}
              options={[
                { value: 'recent', label: '開始日時順（新しい順）' },
                { value: 'priority', label: '優先度順' },
              ]}
            />
          </div>
        )}
        trailing={(
          <>
            <AppButton size="sm" variant="outline-secondary" onClick={toggleSelectAll} disabled={actionableIds.length === 0}>
              {allSelected ? '選択解除' : '全選択'}
            </AppButton>
            <LoadingButton
              size="sm"
              variant="success"
              onClick={() => void handleBulkAction('accept')}
              disabled={selectedIds.length === 0}
              loading={bulkActionLoading === 'accept'}
              loadingLabel="承認中..."
            >
              一括承認
            </LoadingButton>
            <LoadingButton
              size="sm"
              variant="danger"
              onClick={() => void handleBulkAction('reject')}
              disabled={selectedIds.length === 0}
              loading={bulkActionLoading === 'reject'}
              loadingLabel="拒否中..."
            >
              一括辞退
            </LoadingButton>
          </>
        )}
      />

      <ScrollArea>
      <AppDataTable
        loading={loading}
        error={error}
        onRetry={() => void retry()}
        loadingText="マッチング一覧を読み込み中..."
        isEmpty={proposals.length === 0}
        emptyTitle="マッチング履歴はまだありません"
        emptyDescription="マッチング実行後に履歴が表示されます。"
        emptyActionLabel="マッチングへ進む"
        emptyActionTo="/matching"
        desktop={() => (
          <div className="table-responsive">
            <AppTable striped hover className="mobile-table">
              <thead className="table-light">
                <tr>
                  <th></th>
                  <th>ID</th>
                  <th>相手薬局</th>
                  <th>ステータス</th>
                  <th>優先度</th>
                  <th>A側薬価</th>
                  <th>B側薬価</th>
                  <th>差額</th>
                  <th>開始日</th>
                  <th>期限</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const isA = p.pharmacyAId === user?.id;
                  const otherName = isA ? p.pharmacyBName : p.pharmacyAName;
                  const statusInfo = proposalStatusStyle(p.status);
                  const selectable = canAcceptProposal(p, user?.id) || canRejectProposal(p);

                  return (
                    <tr key={p.id}>
                      <td>
                        <FormCheck
                          checked={selectedIdSet.has(p.id)}
                          onChange={() => toggleSelection(p.id)}
                          disabled={!selectable}
                          aria-label={`proposal-${p.id}`}
                        />
                      </td>
                      <td>{p.id}</td>
                      <td>{otherName}</td>
                      <td><Badge bg={statusInfo.variant}>{statusInfo.label}</Badge></td>
                      <td>
                        <div className="fw-semibold">{(p.priorityScore ?? 0).toFixed(1)}</div>
                        <div className="small text-muted">{(p.priorityReasons ?? []).join(' / ')}</div>
                      </td>
                      <td>{formatYen(p.totalValueA)}</td>
                      <td>{formatYen(p.totalValueB)}</td>
                      <td>{formatYen(p.valueDifference)}</td>
                      <td>{formatDateTimeJa(p.proposedAt)}</td>
                      <td>{formatDateTimeJa(p.deadlineAt)}</td>
                      <td><Link to={`/proposals/${p.id}`} className="btn btn-sm btn-outline-primary">詳細</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </AppTable>
          </div>
        )}
        mobile={() => (
          <div className="dl-mobile-data-list">
            {proposals.map((p) => {
              const isA = p.pharmacyAId === user?.id;
              const otherName = isA ? p.pharmacyBName : p.pharmacyAName;
              const statusInfo = proposalStatusStyle(p.status);
              const selectable = canAcceptProposal(p, user?.id) || canRejectProposal(p);

              return (
                <AppMobileDataCard
                  key={p.id}
                  title={`マッチング #${p.id}`}
                  subtitle={otherName}
                  badges={<Badge bg={statusInfo.variant}>{statusInfo.label}</Badge>}
                  fields={[
                    { label: '優先度', value: (p.priorityScore ?? 0).toFixed(1) },
                    { label: '優先理由', value: (p.priorityReasons ?? []).join(' / ') || '-' },
                    { label: 'A側薬価', value: formatYen(p.totalValueA) },
                    { label: 'B側薬価', value: formatYen(p.totalValueB) },
                    { label: '差額', value: formatYen(p.valueDifference) },
                    { label: '開始日', value: formatDateTimeJa(p.proposedAt) },
                    { label: '期限', value: formatDateTimeJa(p.deadlineAt) },
                  ]}
                  actions={(
                    <div className="d-flex flex-column gap-2">
                      <FormCheck
                        checked={selectedIdSet.has(p.id)}
                        onChange={() => toggleSelection(p.id)}
                        disabled={!selectable}
                        label="一括対象に追加"
                        aria-label={`${otherName}との提案を一括対象に追加`}
                      />
                      <Link to={`/proposals/${p.id}`} className="btn btn-sm btn-outline-primary w-100">詳細</Link>
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
