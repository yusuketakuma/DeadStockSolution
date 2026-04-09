import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppTable from '../components/ui/AppTable';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import LoadingButton from '../components/ui/LoadingButton';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import { Badge, FormCheck } from 'react-bootstrap';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import AppCard from '../components/ui/AppCard';
import SavedViewsPanel from '../components/ui/SavedViewsPanel';
import PullToRefresh from '../components/gesture/PullToRefresh';
import SwipeableListItem from '../components/gesture/SwipeableListItem';
import ProposalNavigationLinks, { type ProposalNavigationLinkGroup } from '../components/proposal/ProposalNavigationLinks';
import { useListDetailRouteState } from '../hooks/useListDetailRouteState';
import { useKeyboardListNavigation } from '../hooks/useKeyboardListNavigation';
import { useSavedViews } from '../hooks/useSavedViews';
import WorkContextBar from '../components/ui/WorkContextBar';

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
  hasPendingCounterOffer?: boolean;
  pendingCounterOfferRole?: 'sent' | 'received' | null;
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
const PROPOSALS_SAVED_VIEWS_KEY = 'proposals:saved-views';

interface ProposalSavedFilters {
  searchText: string;
  sortMode: ProposalSortMode;
}

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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { requestedSelectedValue, requestedPage, updateListDetailRouteState } = useListDetailRouteState(searchParams, setSearchParams);
  const requestedSortMode = searchParams.get('sort') === 'priority' ? 'priority' : 'recent';
  const requestedSearchText = searchParams.get('q') ?? '';
  const requestedSelectedId = Number(requestedSelectedValue ?? '');
  const [sortMode, setSortMode] = useState<ProposalSortMode>(requestedSortMode);
  const [searchText, setSearchText] = useState(requestedSearchText);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(Number.isInteger(requestedSelectedId) && requestedSelectedId > 0 ? requestedSelectedId : null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState<'accept' | 'reject' | null>(null);
  const [message, setMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const initializedSortRef = useRef(false);
  const { savedViews, createSavedView, deleteSavedView } = useSavedViews<ProposalSavedFilters>(PROPOSALS_SAVED_VIEWS_KEY);

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
    { errorMessage: 'マッチング一覧の取得に失敗しました', initialPage: requestedPage },
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

  useEffect(() => {
    setSortMode((current) => (current === requestedSortMode ? current : requestedSortMode));
  }, [requestedSortMode]);

  useEffect(() => {
    setSearchText((current) => (current === requestedSearchText ? current : requestedSearchText));
  }, [requestedSearchText]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (sortMode !== 'recent') nextParams.set('sort', sortMode);
    else nextParams.delete('sort');
    if (searchText.trim()) nextParams.set('q', searchText.trim());
    else nextParams.delete('q');
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, searchText, setSearchParams, sortMode]);

  useEffect(() => {
    updateListDetailRouteState({
      page,
      selected: selectedProposalId,
    });
  }, [page, selectedProposalId, updateListDetailRouteState]);

  useEffect(() => {
    if (page !== requestedPage) {
      setPage(requestedPage);
    }
    if (Number.isInteger(requestedSelectedId) && requestedSelectedId > 0 && requestedSelectedId !== selectedProposalId) {
      setSelectedProposalId(requestedSelectedId);
    }
  }, [page, requestedPage, requestedSelectedId, selectedProposalId, setPage]);

  const visibleProposals = useMemo(() => {
    if (!searchText.trim()) return proposals;
    const query = searchText.trim().toLowerCase();
    return proposals.filter((proposal) => {
      const haystack = [
        proposal.id,
        proposal.pharmacyAName,
        proposal.pharmacyBName,
        proposal.status,
        ...(proposal.priorityReasons ?? []),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [proposals, searchText]);

  useEffect(() => {
    if (visibleProposals.length === 0) {
      setSelectedProposalId(null);
      return;
    }
    if (selectedProposalId && visibleProposals.some((proposal) => proposal.id === selectedProposalId)) {
      return;
    }
    setSelectedProposalId(visibleProposals[0].id);
  }, [selectedProposalId, visibleProposals]);

  const actionableIds = useMemo(() => {
    const viewerId = user?.id;
    return visibleProposals
      .filter((proposal) => canAcceptProposal(proposal, viewerId) || canRejectProposal(proposal))
      .map((proposal) => proposal.id);
  }, [user?.id, visibleProposals]);
  const actionableIdSet = useMemo(() => new Set(actionableIds), [actionableIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedProposal = useMemo(() => visibleProposals.find((proposal) => proposal.id === selectedProposalId) ?? null, [selectedProposalId, visibleProposals]);
  const returnTo = `${location.pathname}${location.search}`;

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

  const saveCurrentView = () => {
    const name = window.prompt('保存ビュー名を入力してください');
    if (!name) return;
    createSavedView(name, { searchText, sortMode });
  };

  useKeyboardListNavigation({
    ids: visibleProposals.map((proposal) => proposal.id),
    selectedId: selectedProposalId,
    setSelectedId: (id) => setSelectedProposalId(id),
    onEnter: (id) => navigate(`/proposals/${id}`, { state: { from: returnTo } }),
    onPrimaryAction: (id) => navigate(`/proposals/${id}`, { state: { from: returnTo } }),
    onSecondaryAction: (id) => {
      window.open(`/proposals/${id}/print`, '_blank', 'noopener');
    },
    searchTargetId: 'proposals-search',
  });

  const ProposalPreviewPanel = () => {
    if (!selectedProposal) {
      return (
        <AppCard className="h-100">
          <AppCard.Header>選択中の提案</AppCard.Header>
          <AppCard.Body className="small text-muted">
            一覧から提案を選ぶと、ここに現在地と次アクションを表示します。
          </AppCard.Body>
        </AppCard>
      );
    }

    const isA = selectedProposal.pharmacyAId === user?.id;
    const otherName = isA ? selectedProposal.pharmacyBName : selectedProposal.pharmacyAName;
    const phaseInfo = getProposalPhaseInfo(selectedProposal.status, isA);
    const waitingInfo = getProposalWaitingInfo(selectedProposal.status, isA, selectedProposal.pharmacyAName, selectedProposal.pharmacyBName);
    const deadlineMeta = getProposalDeadlineMeta(selectedProposal.deadlineAt);

    return (
      <AppCard className="h-100">
        <AppCard.Header>現在の提案</AppCard.Header>
        <AppCard.Body className="d-flex flex-column gap-3">
          <div>
            <div className="fw-semibold">#{selectedProposal.id} {otherName}</div>
            <div className="small text-muted mt-1">一覧の状態を保ったまま、詳細判断に移れます。</div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Badge bg={phaseInfo.variant}>{phaseInfo.phaseLabel}</Badge>
            {waitingInfo ? (
              <Badge bg={waitingInfo.waitingForYou ? 'warning' : 'info'} text="dark">
                {waitingInfo.viewerLabel}
              </Badge>
            ) : null}
            {selectedProposal.hasPendingCounterOffer ? (
              <Badge bg={selectedProposal.pendingCounterOfferRole === 'received' ? 'danger' : 'secondary'}>
                {selectedProposal.pendingCounterOfferRole === 'received' ? '反対提案あり' : '反対提案送信済み'}
              </Badge>
            ) : null}
          </div>
          <div className="small">
            <div>開始: {formatDateTimeJa(selectedProposal.proposedAt)}</div>
            <div>期限: {deadlineMeta.remainingLabel}</div>
            <div>差額: {formatYen(selectedProposal.valueDifference)}</div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <Link to={`/proposals/${selectedProposal.id}`} state={{ from: returnTo }} className="btn btn-sm btn-outline-primary">
              詳細で処理
            </Link>
            <Link
              to={`/proposals/${selectedProposal.id}/print`}
              state={{ from: returnTo, detailPath: `/proposals/${selectedProposal.id}` }}
              className="btn btn-sm btn-outline-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              印刷/FAX
            </Link>
          </div>
        </AppCard.Body>
      </AppCard>
    );
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

      <WorkContextBar
        title="提案処理キュー"
        currentLabel={selectedProposal ? `選択中: #${selectedProposal.id}` : '選択中: なし'}
        description="sort、page、selected proposal を URL に保持するので、詳細から戻っても同じ一覧状態を復元します。"
        backTo="/matching"
        backLabel="マッチングへ戻る"
        badges={[
          { label: `並び順: ${sortMode === 'priority' ? '優先度' : '開始日時'}`, bg: 'secondary' },
          selectedIds.length > 0 ? { label: `一括対象 ${selectedIds.length} 件`, bg: 'info', text: 'dark' } : null,
          selectedProposal?.hasPendingCounterOffer ? { label: '反対提案あり', bg: 'warning', text: 'dark' } : null,
        ]}
        nextActions={[
          { to: '/matching', label: '候補へ戻る', variant: 'outline-secondary' },
          { to: '/exchange-history', label: '交換履歴', variant: 'outline-secondary' },
        ]}
      />

      <ProposalNavigationLinks groups={PROPOSALS_LINK_GROUPS} />
      <SavedViewsPanel
        description="並び順を保存して再利用できます。"
        shareUrl={typeof window !== 'undefined' ? window.location.href : null}
        savedViews={savedViews}
        presets={[
          {
            key: 'proposal-priority',
            name: '優先提案',
            description: '優先度順で確認します。',
            filters: { searchText: '', sortMode: 'priority' },
          },
          {
            key: 'proposal-recent',
            name: '新着提案',
            description: '開始日時順に戻します。',
            filters: { searchText: '', sortMode: 'recent' },
          },
        ]}
        onSave={saveCurrentView}
        onApply={(filters) => {
          setSearchText(filters.searchText ?? '');
          setSortMode(filters.sortMode === 'priority' ? 'priority' : 'recent');
        }}
        onDelete={deleteSavedView}
      />

      <AppActionBar
        className="mb-3"
        leading={(
          <div className="d-flex align-items-center gap-2 flex-wrap">
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
            <input
              id="proposals-search"
              className="form-control form-control-sm"
              style={{ minWidth: 220 }}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="薬局名・提案IDで検索"
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
        isEmpty={visibleProposals.length === 0}
        emptyTitle="マッチング履歴はまだありません"
        emptyDescription="マッチング実行後に履歴が表示されます。交換履歴やメッセージにも戻れます。"
        emptyActionLabel="マッチングへ進む"
        emptyActionTo="/matching"
        desktop={() => (
          <div className={`dl-two-pane-grid${selectedProposal ? ' dl-pane-detail-active' : ''}`}>
            <div className="dl-stack-gap-md">
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
                    {visibleProposals.map((p) => {
                      const isA = p.pharmacyAId === user?.id;
                      const otherName = isA ? p.pharmacyBName : p.pharmacyAName;
                      const phaseInfo = getProposalPhaseInfo(p.status, isA);
                      const waitingInfo = getProposalWaitingInfo(p.status, isA, p.pharmacyAName, p.pharmacyBName);
                      const selectable = canAcceptProposal(p, user?.id) || canRejectProposal(p);

                      const urgencyClass = getProposalUrgencyClass(p);

                      return (
                        <tr
                          key={p.id}
                          className={`${urgencyClass} ${selectedProposalId === p.id ? 'table-primary' : ''}`}
                          onClick={() => setSelectedProposalId(p.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td onClick={(event) => event.stopPropagation()}>
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
                              {p.hasPendingCounterOffer ? (
                                <span className={`small ${p.pendingCounterOfferRole === 'received' ? 'text-danger' : 'text-primary'}`}>
                                  {p.pendingCounterOfferRole === 'received' ? '正式な反対提案あり' : '反対提案を送信済み'}
                                </span>
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
                          <td onClick={(event) => event.stopPropagation()}>
                            <div className="d-flex gap-2 flex-wrap">
                              <Link to={`/proposals/${p.id}`} state={{ from: returnTo }} className="btn btn-sm btn-outline-primary">詳細</Link>
                              <Link
                                to={`/proposals/${p.id}/print`}
                                state={{ from: returnTo, detailPath: `/proposals/${p.id}` }}
                                className="btn btn-sm btn-outline-secondary"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
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
            </div>
            <div className="dl-stack-gap-md">
              <ProposalPreviewPanel />
            </div>
          </div>
        )}
        mobile={() => (
          <div className="dl-mobile-data-list">
            {visibleProposals.map((p) => {
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
                        {p.hasPendingCounterOffer ? (
                          <span className={`small ${p.pendingCounterOfferRole === 'received' ? 'text-danger' : 'text-primary'}`}>
                            {p.pendingCounterOfferRole === 'received' ? '正式な反対提案あり' : '反対提案を送信済み'}
                          </span>
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
                        <Link to={`/proposals/${p.id}`} state={{ from: returnTo }} className="btn btn-sm btn-outline-primary w-100">詳細</Link>
                        <Link
                          to={`/proposals/${p.id}/print`}
                          state={{ from: returnTo, detailPath: `/proposals/${p.id}` }}
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
