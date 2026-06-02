import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Form, Modal } from 'react-bootstrap';
import {
  createBookmark,
  deleteBookmark,
  fetchBookmarksPage,
  fetchMatchingDismissStats,
  recordMatchingDismissFeedback,
  type MatchingDismissStats,
} from '../api/match-bookmarks';
import RequireUpload from '../components/RequireUpload';
import { DEFAULT_FILTERS, type MatchingFilterState } from '../components/matching/MatchingFilters';
import MatchingFiltersPanel from '../components/matching/MatchingFiltersPanel';
import MatchingResultsList from '../components/matching/MatchingResultsList';
import ProposalQuantityAdjustModal from '../components/matching/ProposalQuantityAdjustModal';
import MatchingSearchHeader from '../components/matching/MatchingSearchHeader';
import ProposalTemplateSelector from '../components/matching/ProposalTemplateSelector';
import { markMatchingDone, readOnboardingMatchingDone } from '../components/onboarding/onboardingSteps';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import AppButton from '../components/ui/AppButton';
import AppCard from '../components/ui/AppCard';
import { useAuth } from '../contexts/AuthContext';
import { useGroupMembership } from '../hooks/useGroupMembership';
import { useAsyncState } from '../hooks/useAsyncState';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';
import type { MatchCandidate } from '../types/matching';
import {
  buildMatchingFilterParams,
  parseMatchingFiltersFromSearchParams,
  parseMatchingFiltersFromStorage,
  parsePositiveId,
  parseRequestedDrugTerms,
  persistMatchingFilters,
  resolveCandidateExpiryTime,
  resolveProposalMessageState,
} from './matching-page-utils';
import {
  MATCHING_DISMISS_REASON_LABELS,
  type MatchingDismissReason,
} from '../utils/matching-dismiss-feedback';

function countNearExpiryItems(candidate: MatchCandidate): number {
  const thresholdMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return candidate.itemsFromA
    .concat(candidate.itemsFromB)
    .map(resolveCandidateExpiryTime)
    .filter((value): value is number => value !== null && value <= thresholdMs)
    .length;
}

export default function MatchingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [filters, setFilters] = useState<MatchingFilterState>(() =>
    parseMatchingFiltersFromSearchParams(new URLSearchParams(window.location.search))
    ?? parseMatchingFiltersFromStorage()
    ?? DEFAULT_FILTERS,
  );
  const { loading, setLoading, error, setError, message, setMessage } = useAsyncState();
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [proposalRetrySuggested, setProposalRetrySuggested] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [candidateForProposal, setCandidateForProposal] = useState<MatchCandidate | null>(null);
  const [comparePharmacyIds, setComparePharmacyIds] = useState<number[]>([]);
  const [dismissCandidate, setDismissCandidate] = useState<MatchCandidate | null>(null);
  const [dismissReason, setDismissReason] = useState<MatchingDismissReason>('distance');
  const [dismissStats, setDismissStats] = useState<MatchingDismissStats>({
    distance: 0,
    expiry: 0,
    value_gap: 0,
    item_fit: 0,
    other: 0,
  });
  const [bookmarkMap, setBookmarkMap] = useState<Map<string, number>>(new Map());
  const [bookmarkPending, setBookmarkPending] = useState<Set<string>>(new Set());
  const requestedTargetPharmacyId = useMemo(
    () => parsePositiveId(searchParams.get('targetPharmacyId')),
    [searchParams],
  );
  const inventorySearchDrugs = (searchParams.get('inventorySearchDrugs') ?? '').trim();
  const requestedDrug = (searchParams.get('drug') ?? '').trim();
  const requestedDrugTerms = useMemo(
    () => parseRequestedDrugTerms(requestedDrug, inventorySearchDrugs),
    [inventorySearchDrugs, requestedDrug],
  );
  const requestedDrugLabel = requestedDrug || inventorySearchDrugs;
  const { groupPharmacyIds } = useGroupMembership({ includeMemberIds: true });
  const hasSearchContext = requestedTargetPharmacyId !== null || requestedDrugTerms.length > 0;
  const autoSearchKey = useMemo(
    () => JSON.stringify({ targetPharmacyId: requestedTargetPharmacyId, requestedDrugTerms }),
    [requestedDrugTerms, requestedTargetPharmacyId],
  );
  const lastAutoSearchKeyRef = useRef<string | null>(null);

  const displayCandidates = useMemo(() => {
    let filteredCandidates = candidates;
    if (requestedTargetPharmacyId !== null) {
      filteredCandidates = filteredCandidates.filter((candidate) => candidate.pharmacyId === requestedTargetPharmacyId);
    }
    if (requestedDrugTerms.length > 0) {
      filteredCandidates = filteredCandidates.filter((candidate) =>
        requestedDrugTerms.some((term) =>
          candidate.itemsFromA.some((item) => item.drugName.toLowerCase().includes(term))
          || candidate.itemsFromB.some((item) => item.drugName.toLowerCase().includes(term)),
        ),
      );
    }
    if (filters.favoriteOnly) {
      filteredCandidates = filteredCandidates.filter((candidate) => candidate.isFavorite === true);
    }
    if (filters.groupOnly) {
      filteredCandidates = filteredCandidates.filter((candidate) => groupPharmacyIds.has(candidate.pharmacyId));
    }
    if (filters.minScore !== null) {
      filteredCandidates = filteredCandidates.filter((candidate) => (candidate.score ?? 0) >= filters.minScore!);
    }

    return [...filteredCandidates].sort((a, b) => {
      let diff = 0;
      if (filters.sortBy === 'score') diff = (a.score ?? 0) - (b.score ?? 0);
      if (filters.sortBy === 'distance') diff = a.distance - b.distance;
      if (filters.sortBy === 'price') diff = (a.totalValueA + a.totalValueB) - (b.totalValueA + b.totalValueB);
      if (filters.sortBy === 'expiry') {
        const getEarliestExpiry = (candidate: MatchCandidate): number => {
          const dates = [...candidate.itemsFromA, ...candidate.itemsFromB]
            .map(resolveCandidateExpiryTime)
            .filter((value): value is number => value !== null);
          return dates.length > 0 ? Math.min(...dates) : Infinity;
        };
        diff = getEarliestExpiry(a) - getEarliestExpiry(b);
      }
      return filters.sortOrder === 'asc' ? diff : -diff;
    });
  }, [candidates, filters, groupPharmacyIds, requestedDrugTerms, requestedTargetPharmacyId]);

  const comparedCandidates = useMemo(() => comparePharmacyIds
    .map((pharmacyId) => candidates.find((candidate) => candidate.pharmacyId === pharmacyId) ?? null)
    .filter((candidate): candidate is MatchCandidate => candidate !== null), [candidates, comparePharmacyIds]);

  useEffect(() => {
    async function loadBookmarks() {
      try {
        const res = await fetchBookmarksPage(1, 100);
        const nextMap = new Map<string, number>();
        for (const bookmark of res.items) {
          nextMap.set(`${bookmark.candidatePharmacyId}:${bookmark.drugCode}`, bookmark.id);
        }
        setBookmarkMap(nextMap);
      } catch {
        // noop
      }
    }
    void loadBookmarks();
  }, []);

  useEffect(() => {
    void fetchMatchingDismissStats()
      .then((response) => {
        if (response?.stats) {
          setDismissStats(response.stats);
        }
      })
      .catch(() => {
        // noop
      });
  }, []);

  useEffect(() => {
    setComparePharmacyIds((prev) => prev.filter((pharmacyId) => candidates.some((candidate) => candidate.pharmacyId === pharmacyId)).slice(0, 2));
  }, [candidates]);

  useEffect(() => {
    persistMatchingFilters(filters);
    const nextParams = buildMatchingFilterParams(searchParams, filters);
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters, searchParams, setSearchParams]);

  const handleToggleBookmark = useCallback(async (candidate: MatchCandidate, drugCode: string) => {
    const key = `${candidate.pharmacyId}:${drugCode}`;
    if (bookmarkPending.has(key)) return;
    setBookmarkPending((prev) => new Set(prev).add(key));
    try {
      const existingId = bookmarkMap.get(key);
      if (existingId !== undefined) {
        await deleteBookmark(existingId);
        setBookmarkMap((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } else {
        const created = await createBookmark({ candidatePharmacyId: candidate.pharmacyId, drugCode });
        setBookmarkMap((prev) => new Map(prev).set(key, created.id));
      }
    } catch {
      // noop
    } finally {
      setBookmarkPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [bookmarkMap, bookmarkPending]);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError('');
    setMessage('');
    setProposalRetrySuggested(false);
    try {
      const data = await api.post<{ candidates: MatchCandidate[] }>('/exchange/find', {
        groupOnly: filters.groupOnly,
      });
      setCandidates(data.candidates);
      setSearched(true);
      if (!readOnboardingMatchingDone(user?.id)) {
        markMatchingDone(user?.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'マッチングに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [filters.groupOnly, setError, setLoading, setMessage, user]);

  useEffect(() => {
    if (!hasSearchContext) {
      lastAutoSearchKeyRef.current = null;
      return;
    }
    if (lastAutoSearchKeyRef.current === autoSearchKey) return;
    lastAutoSearchKeyRef.current = autoSearchKey;
    void handleSearch();
  }, [autoSearchKey, handleSearch, hasSearchContext]);

  useEffect(() => {
    if (requestedTargetPharmacyId === null) return;
    setExpandedIdx(displayCandidates.length === 1 ? 0 : null);
  }, [displayCandidates.length, requestedTargetPharmacyId]);

  const handleSendProposal = useCallback(async (candidate: MatchCandidate) => {
    setProposalSubmitting(true);
    setProposalRetrySuggested(false);
    try {
      await api.post('/exchange/proposals', { candidate });
      setMessage(`${candidate.pharmacyName}との仮マッチングを開始しました。相手薬局の承認をお待ちください。`);
      setCandidates((prev) => prev.filter((current) => current.pharmacyId !== candidate.pharmacyId));
      setCandidateForProposal(null);
    } catch (err) {
      const proposalMessageState = resolveProposalMessageState(err);
      setError(proposalMessageState.errorMessage);
      setProposalRetrySuggested(proposalMessageState.shouldSuggestRetry);
    } finally {
      setProposalSubmitting(false);
    }
  }, [setError, setMessage]);

  const handleToggleCompareCandidate = useCallback((candidate: MatchCandidate) => {
    setComparePharmacyIds((prev) => {
      if (prev.includes(candidate.pharmacyId)) {
        return prev.filter((pharmacyId) => pharmacyId !== candidate.pharmacyId);
      }
      if (prev.length >= 2) {
        return prev;
      }
      return [...prev, candidate.pharmacyId];
    });
  }, []);

  const handlePrioritizeUrgent = useCallback(() => {
    setFilters((prev) => ({ ...prev, sortBy: 'expiry', sortOrder: 'asc' }));
  }, []);

  const dominantDismissReason = useMemo(() => Object.entries(dismissStats)
    .sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] as MatchingDismissReason | undefined, [dismissStats]);

  const handleConfirmDismiss = useCallback(async () => {
    if (!dismissCandidate) return;
    setCandidates((prev) => prev.filter((candidate) => candidate.pharmacyId !== dismissCandidate.pharmacyId));
    try {
      const response = await recordMatchingDismissFeedback({
        candidatePharmacyId: dismissCandidate.pharmacyId,
        reason: dismissReason,
        drugCodes: [...new Set(dismissCandidate.itemsFromA.concat(dismissCandidate.itemsFromB)
          .map((item) => item.drugCode?.trim() ?? '')
          .filter(Boolean))],
      });
      if (response?.stats) {
        setDismissStats(response.stats);
      }
    } catch {
      setDismissStats((prev) => ({
        ...prev,
        [dismissReason]: prev[dismissReason] + 1,
      }));
    }
    setDismissCandidate(null);
  }, [dismissCandidate, dismissReason]);

  return (
    <RequireUpload>
      <PageShell>
        <div className="dl-page-header">
          <div className="dl-page-header-copy">
            <h4 className="page-title mb-0">マッチング</h4>
            <div className="text-muted small">候補検索、ブックマーク、提案作成をこの画面から進めます。</div>
          </div>
          <div className="dl-page-header-actions mobile-stack">
            <Link to="/bookmarks" className="btn btn-primary btn-sm">ブックマークを確認</Link>
            <AppDropdownMenu
              label="関連画面"
              variant="outline-secondary"
              items={[
                { key: 'proposals', to: '/proposals', label: '提案一覧を確認' },
                { key: 'history', to: '/exchange-history', label: '交換履歴を確認' },
              ]}
            />
          </div>
        </div>
        <ScrollArea>
          {error && <ErrorRetryAlert error={error} onRetry={() => { setError(''); void handleSearch(); }} />}
          <MatchingSearchHeader
            loading={loading}
            proposalRetrySuggested={proposalRetrySuggested}
            message={message}
            inventorySearchDrugs={inventorySearchDrugs}
            requestedDrugTerms={requestedDrugTerms}
            requestedDrugLabel={requestedDrugLabel}
            requestedTargetPharmacyId={requestedTargetPharmacyId}
            onRetrySearch={handleSearch}
            onShowAllCandidates={() => navigate('/matching')}
            onSearch={handleSearch}
          />

          <ProposalTemplateSelector onUseMessage={setMessage} />

          <MatchingFiltersPanel
            searched={searched}
            candidateCount={candidates.length}
            filters={filters}
            onFilterChange={setFilters}
          />

          {searched && candidates.length > 0 && (
            <AppCard className="mb-3">
              <AppCard.Header>候補比較と優先表示</AppCard.Header>
              <AppCard.Body>
                <div className="dl-action-row mobile-stack align-items-center mb-3">
                  <AppButton
                    type="button"
                    size="sm"
                    variant={filters.sortBy === 'expiry' && filters.sortOrder === 'asc' ? 'warning' : 'primary'}
                    onClick={handlePrioritizeUrgent}
                  >
                    期限切迫を優先
                  </AppButton>
                  {comparePharmacyIds.length > 0 && (
                    <AppDropdownMenu
                      label="その他"
                      variant="outline-secondary"
                      items={[
                        {
                          key: 'clear-compare',
                          label: '比較をクリア',
                          onClick: () => setComparePharmacyIds([]),
                        },
                      ]}
                    />
                  )}
                  <span className="small text-muted">
                    候補カードから 2 件まで比較に追加できます。
                  </span>
                </div>
                {comparedCandidates.length === 0 ? (
                  <div className="small text-muted">
                    比較したい候補で「比較に追加」を押すと、距離・総合スコア・期限切迫件数を横に見比べられます。
                  </div>
                ) : (
                  <div className="row g-3">
                    {comparedCandidates.map((candidate) => (
                      <div key={`compare-${candidate.pharmacyId}`} className="col-12 col-lg-6">
                        <div className="border rounded p-3 h-100">
                          <div className="fw-semibold">{candidate.pharmacyName}</div>
                          <div className="small text-muted mt-1">
                            総合 {candidate.score?.toFixed(1) ?? '-'} / 距離 {candidate.distance}km / 差額 {candidate.valueDifference}円
                          </div>
                          <div className="small text-muted mt-1">
                            期限切迫候補 {countNearExpiryItems(candidate)} 件 / 一致度 {Math.round(candidate.matchRate ?? 0)}%
                          </div>
                          {candidate.priorityReasons && candidate.priorityReasons.length > 0 && (
                            <div className="small mt-2">
                              {candidate.priorityReasons.slice(0, 3).map((reason) => reason.label).join(' / ')}
                            </div>
                          )}
                          <div className="dl-action-row mobile-stack mt-3">
                            <AppButton type="button" size="sm" variant="primary" onClick={() => setCandidateForProposal(candidate)}>
                              この候補で提案
                            </AppButton>
                            <AppDropdownMenu
                              label="その他"
                              variant="outline-secondary"
                              items={[
                                {
                                  key: 'remove-compare',
                                  label: '比較から外す',
                                  onClick: () => setComparePharmacyIds((prev) => prev.filter((pharmacyId) => pharmacyId !== candidate.pharmacyId)),
                                },
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
          )}

          {searched && candidates.length > 0 && (
            <AppCard className="mb-3">
              <AppCard.Header>却下理由の傾向</AppCard.Header>
              <AppCard.Body>
                <div className="dl-badge-row">
                  {Object.entries(MATCHING_DISMISS_REASON_LABELS).map(([reason, label]) => (
                    <span key={reason} className="badge bg-secondary">
                      {label}: {dismissStats[reason as MatchingDismissReason]}
                    </span>
                  ))}
                </div>
                {dominantDismissReason && dismissStats[dominantDismissReason] > 0 && (
                  <div className="small text-muted mt-2">
                    最近もっとも多い却下理由は「{MATCHING_DISMISS_REASON_LABELS[dominantDismissReason]}」です。
                    {dominantDismissReason === 'distance' && ' 距離順やグループ絞り込みを優先すると精度が上がります。'}
                    {dominantDismissReason === 'expiry' && ' 期限切迫優先を使うと判断しやすくなります。'}
                    {dominantDismissReason === 'value_gap' && ' 差額の小さい候補を先に比較してください。'}
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
          )}

          <MatchingResultsList
            searched={searched}
            loading={loading}
            candidatesCount={candidates.length}
            displayCandidates={displayCandidates}
            requestedDrugTerms={requestedDrugTerms}
            requestedDrugLabel={requestedDrugLabel}
            requestedTargetPharmacyId={requestedTargetPharmacyId}
            groupPharmacyIds={groupPharmacyIds}
            expandedIdx={expandedIdx}
            comparePharmacyIds={comparePharmacyIds}
            proposalSubmitting={proposalSubmitting}
            bookmarkMap={bookmarkMap}
            bookmarkPending={bookmarkPending}
            onToggleExpanded={(idx) => setExpandedIdx(expandedIdx === idx ? null : idx)}
            onDismissCandidate={(candidate) => {
              setDismissReason('distance');
              setDismissCandidate(candidate);
            }}
            onOpenProposal={(candidate) => setCandidateForProposal(candidate)}
            onToggleCompareCandidate={handleToggleCompareCandidate}
            onToggleBookmark={handleToggleBookmark}
            onRefresh={handleSearch}
            onShowAllCandidates={() => navigate('/matching')}
          />
        </ScrollArea>

        <ProposalQuantityAdjustModal
          show={candidateForProposal !== null}
          candidate={candidateForProposal}
          onCancel={() => setCandidateForProposal(null)}
          onConfirm={handleSendProposal}
          pending={proposalSubmitting}
        />

        <Modal show={dismissCandidate !== null} onHide={() => setDismissCandidate(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title>候補を閉じる理由</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="small text-muted mb-3">
              {dismissCandidate?.pharmacyName} を除外する理由を記録します。次回の候補確認時の判断に使います。
            </div>
            {Object.entries(MATCHING_DISMISS_REASON_LABELS).map(([reason, label]) => (
              <Form.Check
                key={reason}
                id={`dismiss-reason-${reason}`}
                type="radio"
                name="matching-dismiss-reason"
                className="mb-2"
                checked={dismissReason === reason}
                onChange={() => setDismissReason(reason as MatchingDismissReason)}
                label={label}
              />
            ))}
          </Modal.Body>
          <Modal.Footer>
            <AppButton type="button" variant="outline-secondary" onClick={() => setDismissCandidate(null)}>
              キャンセル
            </AppButton>
            <AppButton type="button" variant="primary" onClick={handleConfirmDismiss}>
              理由を保存して閉じる
            </AppButton>
          </Modal.Footer>
        </Modal>
      </PageShell>
    </RequireUpload>
  );
}
