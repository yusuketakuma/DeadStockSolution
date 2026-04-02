import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppTable from '../components/ui/AppTable';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import LoadingButton from '../components/ui/LoadingButton';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import { Badge, FormCheck } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import { usePaginatedList } from '../hooks/usePaginatedList';
import AppSelect from '../components/ui/AppSelect';
import { formatDateTimeJa, formatYen } from '../utils/formatters';
import { getProposalPhaseInfo, getProposalWaitingInfo } from '../utils/proposal-status';
import { getProposalDeadlineMeta } from '../utils/proposal-expiry';
import AppActionBar from '../components/ui/AppActionBar';
import AppDataTable from '../components/ui/AppDataTable';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import PullToRefresh from '../components/gesture/PullToRefresh';
import SwipeableListItem from '../components/gesture/SwipeableListItem';
import ProposalNavigationLinks, { type ProposalNavigationLinkGroup } from '../components/proposal/ProposalNavigationLinks';

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
  expiryReminderSentAt?: string | null;
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

const PRIORITY_REASON_BADGE: Record<string, { bg: string; text?: string; label: string }> = {
  '期限切迫': { bg: 'warning', text: 'dark', label: '期限切迫' },
  '高薬価': { bg: 'info', label: '高薬価' },
  '高優先度': { bg: 'primary', label: '高優先度' },
  '大量在庫': { bg: 'secondary', label: '大量在庫' },
};

function getPriorityReasonBadge(reason: string): { bg: string; text?: string; label: string } {
  return PRIORITY_REASON_BADGE[reason] ?? { bg: 'secondary', label: reason };
}

function getProposalUrgencyClass(proposal: Proposal): string {
  if (!proposal.deadlineAt) return '';
  const meta = getProposalDeadlineMeta(proposal.deadlineAt);
  if (meta.isExpired) return 'border-start border-danger border-3 bg-danger bg-opacity-10';
  if (meta.isDueSoon) return 'border-start border-warning border-3 bg-warning bg-opacity-10';
  return '';
}

function renderDeadlineCell(deadlineAt: string | null | undefined) {
  const meta = getProposalDeadlineMeta(deadlineAt);
  const badgeClassName = meta.isExpired
    ? 'bg-danger'
    : meta.isDueSoon
      ? 'bg-warning text-dark'
      : 'bg-secondary';

  return (
    <div className="d-flex flex-column gap-1">
      <span>{formatDateTimeJa(deadlineAt)}</span>
      <div className="d-flex flex-wrap gap-1">
        {meta.urgencyLabel ? (
          <span className={`badge ${badgeClassName} align-self-start`}>{meta.urgencyLabel}</span>
        ) : null}
        <span className={`badge ${badgeClassName} align-self-start`}>{meta.remainingLabel}</span>
      </div>
    </div>
  );
}

function renderWaitingBadge(waitingLabel: string, waitingForYou: boolean) {
  return (
    <span className={`badge ${waitingForYou ? 'bg-warning text-dark' : 'bg-info text-dark'} align-self-start`}>
      {waitingLabel}
    </span>
  );
}

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

const PROPOSALS_LINK_GROUPS: readonly ProposalNavigationLinkGroup[] = [
  {
    title: '候補確認',
    description: '一覧の前後で比較する主要画面です。',
    links: [
      { to: '/matching', label: 'マッチング' },
      { to: '/exchange-history', label: '交換履歴' },
      { to: '/messages', label: 'メッセージ' },
    ],
  },
  {
    title: '次の確認',
    description: '空振り時でも通知や保存候補に戻れます。',
    links: [
      { to: '/bookmarks', label: 'ブックマーク' },
      { to: '/notifications', label: '通知センター' },
    ],
  },
] as const;

export default function ProposalsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">マッチング一覧</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/matching" className="btn btn-outline-primary btn-sm">マッチング</Link>
          <Link to="/exchange-history" className="btn btn-outline-secondary btn-sm">交換履歴</Link>
        </div>
      </div>
      {bulkError && <AppAlert variant="danger">{bulkError}</AppAlert>}
      {message && <AppAlert variant="success">{message}</AppAlert>}

      <ProposalNavigationLinks groups={PROPOSALS_LINK_GROUPS} />

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
      <PullToRefresh onRefresh={async () => { await retry(); }}>
      <AppDataTable
        loading={loading}
        error={error}
        onRetry={() => void retry()}
        loadingText="マッチング一覧を読み込み中..."
        isEmpty={proposals.length === 0}
        emptyTitle="マッチング履歴はまだありません"
        emptyDescription="マッチング実行後に履歴が表示されます。交換履歴やメッセージにも戻れます。"
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
                  const phaseInfo = getProposalPhaseInfo(p.status, isA);
                  const waitingInfo = getProposalWaitingInfo(p.status, isA, p.pharmacyAName, p.pharmacyBName);
                  const selectable = canAcceptProposal(p, user?.id) || canRejectProposal(p);

                  const urgencyClass = getProposalUrgencyClass(p);

                  return (
                    <tr key={p.id} className={urgencyClass}>
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
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <Badge bg={phaseInfo.variant}>{phaseInfo.phaseLabel}</Badge>
                          <span className="small text-muted">あなた: {phaseInfo.yourStatus}</span>
                          <span className="small text-muted">相手: {phaseInfo.theirStatus}</span>
                          {waitingInfo ? renderWaitingBadge(waitingInfo.viewerLabel, waitingInfo.waitingForYou) : null}
                          {p.expiryReminderSentAt ? (
                            <span className="small text-warning-emphasis">24時間前リマインド済み</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="fw-semibold">{(p.priorityScore ?? 0).toFixed(1)}</div>
                        <div className="d-flex flex-wrap gap-1 mt-1">
                          {(p.priorityReasons ?? []).map((reason) => {
                            const badge = getPriorityReasonBadge(reason);
                            return (
                              <Badge key={reason} bg={badge.bg} text={badge.text}>
                                {badge.label}
                              </Badge>
                            );
                          })}
                        </div>
                      </td>
                      <td>{formatYen(p.totalValueA)}</td>
                      <td>{formatYen(p.totalValueB)}</td>
                      <td>{formatYen(p.valueDifference)}</td>
                      <td>{formatDateTimeJa(p.proposedAt)}</td>
                      <td>{renderDeadlineCell(p.deadlineAt)}</td>
                      <td>
                        <div className="d-flex gap-2 flex-wrap">
                          <Link to={`/proposals/${p.id}`} className="btn btn-sm btn-outline-primary">詳細</Link>
                          <Link to={`/proposals/${p.id}/print`} className="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener noreferrer">
                            印刷
                          </Link>
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
            {proposals.map((p) => {
              const isA = p.pharmacyAId === user?.id;
              const otherName = isA ? p.pharmacyBName : p.pharmacyAName;
              const phaseInfo = getProposalPhaseInfo(p.status, isA);
              const waitingInfo = getProposalWaitingInfo(p.status, isA, p.pharmacyAName, p.pharmacyBName);
              const selectable = canAcceptProposal(p, user?.id) || canRejectProposal(p);
              const urgencyClass = getProposalUrgencyClass(p);
              const priorityReasons = p.priorityReasons ?? [];

              return (
                <SwipeableListItem
                  key={`swipe-${p.id}`}
                  onSwipeLeft={() => navigate(`/proposals/${p.id}`)}
                  leftContent={<div className="swipe-bg-info"><span className="swipe-icon" aria-hidden="true">{'\u2192'}</span> 詳細</div>}
                  undoDuration={0}
                >
                  <AppMobileDataCard
                    key={p.id}
                    className={urgencyClass}
                    title={`マッチング #${p.id}`}
                    subtitle={otherName}
                    badges={(
                      <div className="d-flex flex-column gap-1 align-items-start">
                        <Badge bg={phaseInfo.variant}>{phaseInfo.phaseLabel}</Badge>
                        <span className="small text-muted">あなた: {phaseInfo.yourStatus}</span>
                        <span className="small text-muted">相手: {phaseInfo.theirStatus}</span>
                        {waitingInfo ? renderWaitingBadge(waitingInfo.viewerLabel, waitingInfo.waitingForYou) : null}
                        {p.expiryReminderSentAt ? (
                          <span className="small text-warning-emphasis">24時間前リマインド済み</span>
                        ) : null}
                      </div>
                    )}
                    fields={[
                      { label: '優先度', value: (p.priorityScore ?? 0).toFixed(1) },
                      {
                        label: '優先理由',
                        value: priorityReasons.length > 0
                          ? (
                            <div className="d-flex flex-wrap gap-1">
                              {priorityReasons.map((reason) => {
                                const badge = getPriorityReasonBadge(reason);
                                return (
                                  <Badge key={reason} bg={badge.bg} text={badge.text}>
                                    {badge.label}
                                  </Badge>
                                );
                              })}
                            </div>
                          )
                          : '-',
                      },
                      { label: 'A側薬価', value: formatYen(p.totalValueA) },
                      { label: 'B側薬価', value: formatYen(p.totalValueB) },
                      { label: '差額', value: formatYen(p.valueDifference) },
                      { label: '開始日', value: formatDateTimeJa(p.proposedAt) },
                      { label: '期限', value: renderDeadlineCell(p.deadlineAt) },
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
                        <Link
                          to={`/proposals/${p.id}/print`}
                          className="btn btn-sm btn-outline-secondary w-100"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          印刷
                        </Link>
                      </div>
                    )}
                  />
                </SwipeableListItem>
              );
            })}
          </div>
        )}
      />
      </PullToRefresh>
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
