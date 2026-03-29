import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  createBookmark,
  deleteBookmark,
  fetchBookmarksPage,
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
import { useAuth } from '../contexts/AuthContext';
import { useGroupMembership } from '../hooks/useGroupMembership';
import { useAsyncState } from '../hooks/useAsyncState';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
      const data = await api.post<{ candidates: MatchCandidate[] }>('/exchange/find');
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
  }, [setError, setLoading, setMessage, user?.id]);

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

  return (
    <RequireUpload>
      <PageShell>
        <h4 className="page-title mb-3">マッチング</h4>
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
            proposalSubmitting={proposalSubmitting}
            bookmarkMap={bookmarkMap}
            bookmarkPending={bookmarkPending}
            onToggleExpanded={(idx) => setExpandedIdx(expandedIdx === idx ? null : idx)}
            onDismissCandidate={(pharmacyId) => setCandidates((prev) => prev.filter((candidate) => candidate.pharmacyId !== pharmacyId))}
            onOpenProposal={(candidate) => setCandidateForProposal(candidate)}
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
      </PageShell>
    </RequireUpload>
  );
}
