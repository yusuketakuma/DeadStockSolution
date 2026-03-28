import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncState } from '../hooks/useAsyncState';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { Badge, Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import {
  createBookmark,
  deleteBookmark,
  fetchBookmarksPage,
} from '../api/match-bookmarks';
import RequireUpload from '../components/RequireUpload';
import { markMatchingDone, readOnboardingMatchingDone } from '../components/onboarding/onboardingSteps';
import { useAuth } from '../contexts/AuthContext';
import BusinessStatusBadge from '../components/BusinessStatusBadge';
import LoadingButton from '../components/ui/LoadingButton';
import AppCard from '../components/ui/AppCard';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import PullToRefresh from '../components/gesture/PullToRefresh';
import SwipeableListItem from '../components/gesture/SwipeableListItem';
import SwipeCoachingOverlay from '../components/gesture/SwipeCoachingOverlay';
import { useGroupMembership } from '../hooks/useGroupMembership';
import MatchingFilters, { DEFAULT_FILTERS, type MatchingFilterState } from '../components/matching/MatchingFilters';
import ProposalTemplatePanel from '../components/proposal/ProposalTemplatePanel';
import MatchCandidateInsightsPanel from '../components/matching/MatchCandidateInsightsPanel';
import ProposalQuantityAdjustModal from '../components/matching/ProposalQuantityAdjustModal';
import {
  compareProposalTemplates,
  listProposalTemplates,
  markProposalTemplateUsed,
  type ProposalTemplate,
} from '../api/proposal-templates';
import type { MatchCandidate, MatchItem } from '../types/matching';
import { buildMessagesPath } from '../utils/message-links';

interface ProposalMessageState {
  errorMessage: string;
  shouldSuggestRetry: boolean;
}

function formatPercent(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

function resolveProposalMessageState(err: unknown): ProposalMessageState {
  const errorMessage = err instanceof Error ? err.message : '仮マッチングの送信に失敗しました';
  return {
    errorMessage,
    shouldSuggestRetry: (
      errorMessage.includes('在庫')
      || errorMessage.includes('数量')
      || errorMessage.includes('利用可能')
    ),
  };
}

function parsePositiveId(value: string | null): number | null {
  if (!value) return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function parseRequestedDrugTerms(requestedDrug: string, inventorySearchDrugs: string): string[] {
  if (requestedDrug) {
    return [requestedDrug.toLowerCase()];
  }

  return inventorySearchDrugs
    .split('/')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function buildCandidateMessageDraft(candidate: MatchCandidate): string {
  const focusDrugs = candidate.itemsFromA
    .slice(0, 3)
    .map((item) => item.drugName)
    .join(' / ');
  return `マッチング候補 #${candidate.pharmacyId} について相談したいです。候補薬剤: ${focusDrugs || '候補明細を確認中'}。`;
}

const MATCHING_FILTER_STORAGE_KEY = 'matching-page-filters';

function parseBooleanParam(value: string | null): boolean {
  return value === '1';
}

function parseMatchingFiltersFromSearchParams(searchParams: URLSearchParams): MatchingFilterState | null {
  const sortBy = searchParams.get('sortBy');
  const sortOrder = searchParams.get('sortOrder');
  const minScoreValue = searchParams.get('minScore');
  if (!sortBy && !sortOrder && !searchParams.has('favoriteOnly') && !searchParams.has('groupOnly') && !minScoreValue) {
    return null;
  }
  const parsedMinScore = minScoreValue === null || minScoreValue === '' ? null : Number(minScoreValue);
  return {
    sortBy: sortBy === 'distance' || sortBy === 'price' || sortBy === 'expiry' ? sortBy : 'score',
    sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
    favoriteOnly: parseBooleanParam(searchParams.get('favoriteOnly')),
    groupOnly: parseBooleanParam(searchParams.get('groupOnly')),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : null,
  };
}

function parseMatchingFiltersFromStorage(): MatchingFilterState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MATCHING_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MatchingFilterState>;
    return {
      sortBy: parsed.sortBy === 'distance' || parsed.sortBy === 'price' || parsed.sortBy === 'expiry' ? parsed.sortBy : 'score',
      sortOrder: parsed.sortOrder === 'asc' ? 'asc' : 'desc',
      favoriteOnly: parsed.favoriteOnly === true,
      groupOnly: parsed.groupOnly === true,
      minScore: typeof parsed.minScore === 'number' ? parsed.minScore : null,
    };
  } catch {
    return null;
  }
}

function persistMatchingFilters(filters: MatchingFilterState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MATCHING_FILTER_STORAGE_KEY, JSON.stringify(filters));
}

function buildMatchingFilterParams(baseParams: URLSearchParams, filters: MatchingFilterState): URLSearchParams {
  const nextParams = new URLSearchParams(baseParams);
  nextParams.delete('sortBy');
  nextParams.delete('sortOrder');
  nextParams.delete('favoriteOnly');
  nextParams.delete('groupOnly');
  nextParams.delete('minScore');

  if (filters.sortBy !== DEFAULT_FILTERS.sortBy) nextParams.set('sortBy', filters.sortBy);
  if (filters.sortOrder !== DEFAULT_FILTERS.sortOrder) nextParams.set('sortOrder', filters.sortOrder);
  if (filters.favoriteOnly) nextParams.set('favoriteOnly', '1');
  if (filters.groupOnly) nextParams.set('groupOnly', '1');
  if (filters.minScore !== null) nextParams.set('minScore', String(filters.minScore));

  return nextParams;
}

function resolveCandidateExpiryTime(item: MatchItem): number | null {
  const source = item.expirationDateIso ?? item.expirationDate;
  if (!source) return null;
  const parsed = new Date(source).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

interface MatchItemsTableProps {
  items: MatchItem[];
  keyPrefix: string;
}

function MatchItemsTable({ items, keyPrefix }: MatchItemsTableProps) {
  return (
    <AppResponsiveSwitch
      desktop={() => (
        <div className="table-responsive">
          <AppTable size="sm" striped className="mb-0 mobile-table">
            <thead>
              <tr>
                <th>薬品名</th>
                <th>数量</th>
                <th>単位</th>
                <th>使用期限</th>
                <th>薬価(単価)</th>
                <th>薬価(合計)</th>
                <th>一致度</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, itemIdx) => (
                <tr key={itemIdx}>
                  <td>{item.drugName}</td>
                  <td>{item.quantity}</td>
                  <td>{item.unit || '-'}</td>
                  <td>{item.expirationDate || '-'}</td>
                  <td>{item.yakkaUnitPrice.toLocaleString()}</td>
                  <td>{item.yakkaValue.toLocaleString()}</td>
                  <td>{formatPercent((item.matchScore ?? 0) * 100)}</td>
                </tr>
              ))}
            </tbody>
          </AppTable>
        </div>
      )}
      mobile={() => (
        <div className="dl-mobile-data-list">
          {items.map((item, itemIdx) => (
            <AppMobileDataCard
              key={`${keyPrefix}-${itemIdx}`}
              title={item.drugName}
              fields={[
                { label: '数量', value: item.quantity },
                { label: '単位', value: item.unit || '-' },
                { label: '使用期限', value: item.expirationDate || '-' },
                { label: '薬価(単価)', value: item.yakkaUnitPrice.toLocaleString() },
                { label: '薬価(合計)', value: item.yakkaValue.toLocaleString() },
                { label: '一致度', value: formatPercent((item.matchScore ?? 0) * 100) },
              ]}
            />
          ))}
        </div>
      )}
    />
  );
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
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  // bookmarks: map of "pharmacyId:drugCode" -> bookmark id
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
    () => JSON.stringify({
      targetPharmacyId: requestedTargetPharmacyId,
      requestedDrugTerms,
    }),
    [requestedDrugTerms, requestedTargetPharmacyId],
  );
  const lastAutoSearchKeyRef = useRef<string | null>(null);

  const displayCandidates = useMemo(() => {
    let filteredCandidates = candidates;

    // URL 経由の初期絞り込み（既存動作を維持）
    if (requestedTargetPharmacyId !== null) {
      filteredCandidates = filteredCandidates.filter(
        (candidate) => candidate.pharmacyId === requestedTargetPharmacyId,
      );
    }
    if (requestedDrugTerms.length > 0) {
      filteredCandidates = filteredCandidates.filter((candidate) =>
        requestedDrugTerms.some((term) =>
          candidate.itemsFromA.some((item) => item.drugName.toLowerCase().includes(term))
          || candidate.itemsFromB.some((item) => item.drugName.toLowerCase().includes(term)),
        ),
      );
    }

    // クライアントサイドフィルタ
    if (filters.favoriteOnly) {
      filteredCandidates = filteredCandidates.filter((c) => c.isFavorite === true);
    }
    if (filters.groupOnly) {
      filteredCandidates = filteredCandidates.filter((c) => groupPharmacyIds.has(c.pharmacyId));
    }
    if (filters.minScore !== null) {
      filteredCandidates = filteredCandidates.filter((c) => (c.score ?? 0) >= (filters.minScore ?? 0));
    }

    // ソート
    const sorted = [...filteredCandidates].sort((a, b) => {
      let diff = 0;
      if (filters.sortBy === 'score') {
        diff = (a.score ?? 0) - (b.score ?? 0);
      } else if (filters.sortBy === 'distance') {
        diff = a.distance - b.distance;
      } else if (filters.sortBy === 'price') {
        diff = (a.totalValueA + a.totalValueB) - (b.totalValueA + b.totalValueB);
      } else if (filters.sortBy === 'expiry') {
        const getEarliestExpiry = (c: MatchCandidate): number => {
          const dates = [...c.itemsFromA, ...c.itemsFromB]
            .map(resolveCandidateExpiryTime)
            .filter((t): t is number => t !== null);
          return dates.length > 0 ? Math.min(...dates) : Infinity;
        };
        diff = getEarliestExpiry(a) - getEarliestExpiry(b);
      }
      return filters.sortOrder === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [candidates, filters, groupPharmacyIds, requestedDrugTerms, requestedTargetPharmacyId]);

  // ブックマーク一覧を読み込んでマップを構築
  useEffect(() => {
    async function loadBookmarks() {
      try {
        const res = await fetchBookmarksPage(1, 100);
        const map = new Map<string, number>();
        for (const b of res.items) {
          map.set(`${b.candidatePharmacyId}:${b.drugCode}`, b.id);
        }
        setBookmarkMap(map);
      } catch {
        // ブックマーク取得失敗は無視（メイン機能に影響させない）
      }
    }
    void loadBookmarks();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadTemplates() {
      setTemplatesLoading(true);
      setTemplateError('');
      try {
        const nextTemplates = await listProposalTemplates();
        if (!mounted) return;
        setTemplates(nextTemplates.sort(compareProposalTemplates));
      } catch (err) {
        if (!mounted) return;
        setTemplateError(err instanceof Error ? err.message : 'テンプレート一覧の取得に失敗しました');
      } finally {
        if (mounted) {
          setTemplatesLoading(false);
        }
      }
    }

    void loadTemplates();
    return () => {
      mounted = false;
    };
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
        const created = await createBookmark({
          candidatePharmacyId: candidate.pharmacyId,
          drugCode,
        });
        setBookmarkMap((prev) => new Map(prev).set(key, created.id));
      }
    } catch {
      // ブックマーク操作失敗は無視
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

  const handleSendProposal = async (candidate: MatchCandidate) => {
    setProposalSubmitting(true);
    setProposalRetrySuggested(false);
    try {
      await api.post('/exchange/proposals', { candidate });
      setMessage(`${candidate.pharmacyName}との仮マッチングを開始しました。相手薬局の承認をお待ちください。`);
      setCandidates((prev) => prev.filter((c) => c.pharmacyId !== candidate.pharmacyId));
      setCandidateForProposal(null);
    } catch (err) {
      const proposalMessageState = resolveProposalMessageState(err);
      setError(proposalMessageState.errorMessage);
      setProposalRetrySuggested(proposalMessageState.shouldSuggestRetry);
    } finally {
      setProposalSubmitting(false);
    }
  };

  const buildTemplateMatchingPath = useCallback((template: ProposalTemplate) => {
    const params = new URLSearchParams();
    params.set('targetPharmacyId', String(template.targetPharmacyId));
    const itemTerms = template.items
      .map((item) => item.drugName.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (itemTerms.length > 0) {
      params.set('inventorySearchDrugs', itemTerms.join('/'));
    }
    return `/matching?${params.toString()}`;
  }, []);

  const handleUseTemplate = useCallback((template: ProposalTemplate) => {
    setMessage(`テンプレート「${template.name}」の条件で候補を確認します。`);
    void markProposalTemplateUsed(template.id)
      .then((updatedTemplate) => {
        setTemplates((prev) => prev
          .map((current) => (current.id === updatedTemplate.id ? updatedTemplate : current))
          .sort(compareProposalTemplates));
      })
      .catch(() => {
        // Navigation should not be blocked even if the usage counter update fails.
      });
  }, [setMessage]);

  return (
    <RequireUpload>
      <PageShell>
        <h4 className="page-title mb-3">マッチング</h4>
        <ScrollArea>
        {error && <ErrorRetryAlert error={error} onRetry={() => { setError(''); void handleSearch(); }} />}
        {proposalRetrySuggested && (
          <AppAlert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <span className="small">在庫状態が更新された可能性があります。最新条件で再マッチングしてください。</span>
            <LoadingButton size="sm" variant="outline-warning" onClick={handleSearch} loading={loading} loadingLabel="再実行中...">
              再マッチング
            </LoadingButton>
          </AppAlert>
        )}
        {message && <AppAlert variant="success">{message}</AppAlert>}
        {(requestedTargetPharmacyId !== null || inventorySearchDrugs) && (
          <AppAlert variant="info" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <span className="small">
              医薬品在庫検索からマッチング候補を確認しています。
              {inventorySearchDrugs && (
                <>
                  {' '}対象薬剤: <strong>{inventorySearchDrugs}</strong>
                </>
              )}
            </span>
            <AppButton type="button" variant="outline-info" size="sm" onClick={() => navigate('/matching')}>
              全候補を表示
            </AppButton>
          </AppAlert>
        )}
        {requestedDrugTerms.length > 0 && (
          <AppAlert variant="info" className="small">
            対象薬剤: <strong>{requestedDrugLabel}</strong>（一致候補を優先表示）
          </AppAlert>
        )}

        <AppCard className="mb-3">
          <AppCard.Body>
            <p className="mb-2">
              デッドストックリストと医薬品使用量リストの一致度・距離・金額バランスをもとに、交換候補を優先順位付きで表示します。
            </p>
            <div className="small text-muted mb-3">
              条件: 双方1万円以上 / 差額10円以内
            </div>
            <LoadingButton onClick={handleSearch} variant="primary" loading={loading} loadingLabel="マッチング中...">
              マッチングを実行
            </LoadingButton>
          </AppCard.Body>
        </AppCard>

        <ProposalTemplatePanel
          title="保存済み提案テンプレート"
          templates={templates}
          loading={templatesLoading}
          error={templateError}
          buildUseTo={buildTemplateMatchingPath}
          useLabel="この条件で候補を探す"
          emptyMessage="完了済み提案をテンプレート保存すると、交換先や品目を絞って再検索できます。"
          onUse={handleUseTemplate}
        />

        {searched && candidates.length > 0 && (
          <MatchingFilters filters={filters} onFilterChange={setFilters} />
        )}

        {searched && candidates.length === 0 && !loading && (
          <AppAlert variant="info">
            交換候補が見つかりませんでした。アップロード内容を更新後、再実行してください。
          </AppAlert>
        )}
        {searched && candidates.length > 0 && displayCandidates.length === 0 && requestedDrugTerms.length > 0 && !loading && (
          <AppAlert variant="warning">
            「{requestedDrugLabel}」に一致する候補は見つかりませんでした。クエリを外すと全候補を確認できます。
          </AppAlert>
        )}
        {searched && candidates.length > 0 && displayCandidates.length === 0 && requestedTargetPharmacyId !== null && !loading && (
          <AppAlert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <span>選択した薬局は現在マッチング候補にありません。全候補を表示して他の候補を確認できます。</span>
            <AppButton type="button" variant="outline-warning" size="sm" onClick={() => navigate('/matching')}>
              全候補を表示
            </AppButton>
          </AppAlert>
        )}

        <PullToRefresh onRefresh={async () => { await handleSearch(); }} disabled={!searched}>
        {displayCandidates.map((candidate, idx) => (
            <SwipeableListItem
              key={`swipe-${candidate.pharmacyId}`}
              onSwipeLeft={() => setCandidates((prev) => prev.filter((c) => c.pharmacyId !== candidate.pharmacyId))}
              onSwipeRight={() => setCandidateForProposal(candidate)}
              leftContent={<div className="swipe-bg-reject"><span className="swipe-icon" aria-hidden="true">{'\u2715'}</span> 拒否</div>}
              rightContent={<div className="swipe-bg-approve"><span className="swipe-icon" aria-hidden="true">{'\u2713'}</span> 承認</div>}
              undoDuration={5000}
            >
            <AppCard key={candidate.pharmacyId} className="mb-3">
            <AppCard.Header className="p-0">
              <AppButton
                type="button"
                variant="link"
                className="match-candidate-toggle w-100 d-flex justify-content-between align-items-center mobile-card-header"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                aria-expanded={expandedIdx === idx}
                aria-controls={`candidate-panel-${candidate.pharmacyId}`}
              >
                <span>
                  <strong>{candidate.pharmacyName}</strong>
                  {candidate.isFavorite && <Badge bg="warning" text="dark" className="ms-2">お気に入り</Badge>}
                  {groupPharmacyIds.has(candidate.pharmacyId) && <Badge bg="success" className="ms-2">グループ</Badge>}
                  {candidate.matchType === 'equivalent' && <Badge bg="info" className="ms-2">同等品</Badge>}
                  {candidate.matchType === 'exact' && <Badge bg="success" className="ms-2">同一薬剤</Badge>}
                  <span className="small text-muted d-block">
                    TEL: {candidate.pharmacyPhone || '-'} / FAX: {candidate.pharmacyFax || '-'}
                  </span>
                </span>
                <span className="d-flex flex-wrap gap-2">
                  <BusinessStatusBadge status={candidate.businessStatus} showHours />
                  <Badge bg="info">{candidate.distance}km</Badge>
                  <Badge bg="secondary">一致度 {formatPercent(candidate.matchRate)}</Badge>
                  <Badge bg="primary">総合 {candidate.score?.toFixed(1) ?? '-'}</Badge>
                  <Badge bg={candidate.valueDifference <= 10 ? 'success' : 'warning'}>
                    差額 {candidate.valueDifference}円
                  </Badge>
                </span>
              </AppButton>
            </AppCard.Header>

            {expandedIdx === idx && (
              <AppCard.Body id={`candidate-panel-${candidate.pharmacyId}`}>
                {candidate.businessStatus?.closingSoon && (
                  <AppAlert variant="warning" className="py-2 mb-3">
                    この薬局はまもなく営業終了です（本日 {candidate.businessStatus.todayHours?.closeTime} まで）
                  </AppAlert>
                )}
                {candidate.matchType === 'equivalent' && (
                  <AppAlert variant="info" className="py-2 mb-3 small">
                    この候補は同等品マッチングにより表示されています。薬品名が異なる場合でも、同等品として登録された薬剤が含まれます。
                  </AppAlert>
                )}
                <MatchCandidateInsightsPanel candidate={candidate} />
                <Row className="g-3 mb-3">
                  <Col lg={6}>
                    <h6>あなた → {candidate.pharmacyName} ({candidate.totalValueA.toLocaleString()}円)</h6>
                    <MatchItemsTable items={candidate.itemsFromA} keyPrefix={`${candidate.pharmacyId}-a`} />
                  </Col>
                  <Col lg={6}>
                    <h6>{candidate.pharmacyName} → あなた ({candidate.totalValueB.toLocaleString()}円)</h6>
                    <MatchItemsTable items={candidate.itemsFromB} keyPrefix={`${candidate.pharmacyId}-b`} />
                  </Col>
                </Row>

                <AppCard className="mb-3">
                  <AppCard.Header className="py-2">
                    交換様式（FAX送信用）
                  </AppCard.Header>
                  <AppCard.Body className="small">
                    <ol className="mb-3">
                      <li>「仮マッチングする」ボタンで仮マッチングを開始します。</li>
                      <li>本内容を印刷し、提案元薬局が同意欄に記入・押印後、相手薬局のFAXへ送信します（送信先: {candidate.pharmacyFax || '相手薬局に確認'}）。</li>
                      <li>相手薬局は内容確認後、同意欄を記入してFAX返信します。</li>
                      <li>双方がシステム上で「承認」すると仮マッチングが確定となります。</li>
                      <li>受け渡し完了後に「交換完了」を実行します。</li>
                    </ol>
                    <AppResponsiveSwitch
                      desktop={() => (
                        <div className="table-responsive">
                          <AppTable bordered size="sm" className="mb-0 mobile-table">
                            <thead>
                              <tr>
                                <th>薬局</th>
                                <th>同意区分</th>
                                <th>担当者署名/押印</th>
                                <th>確認日</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>あなたの薬局</td>
                                <td>[ ] 同意  [ ] 条件付き同意  [ ] 不同意</td>
                                <td className="agreement-sign-cell"></td>
                                <td className="agreement-date-cell"></td>
                              </tr>
                              <tr>
                                <td>{candidate.pharmacyName}</td>
                                <td>[ ] 同意  [ ] 条件付き同意  [ ] 不同意</td>
                                <td></td>
                                <td></td>
                              </tr>
                            </tbody>
                          </AppTable>
                        </div>
                      )}
                      mobile={() => (
                        <div className="dl-mobile-data-list">
                          <AppMobileDataCard
                            title="あなたの薬局"
                            fields={[
                              { label: '同意区分', value: '[ ] 同意  [ ] 条件付き同意  [ ] 不同意' },
                              { label: '担当者署名/押印', value: '記入欄' },
                              { label: '確認日', value: '記入欄' },
                            ]}
                          />
                          <AppMobileDataCard
                            title={candidate.pharmacyName}
                            fields={[
                              { label: '同意区分', value: '[ ] 同意  [ ] 条件付き同意  [ ] 不同意' },
                              { label: '担当者署名/押印', value: '記入欄' },
                              { label: '確認日', value: '記入欄' },
                            ]}
                          />
                        </div>
                      )}
                    />
                  </AppCard.Body>
                </AppCard>

                <div className="d-flex gap-2 mobile-stack flex-wrap">
                  <LoadingButton variant="success" onClick={() => setCandidateForProposal(candidate)} loading={proposalSubmitting} loadingLabel="提案中...">
                    仮マッチングする
                  </LoadingButton>
                  <AppButton
                    as="a"
                    href={buildMessagesPath({
                      pharmacyId: candidate.pharmacyId,
                      pharmacyName: candidate.pharmacyName,
                      draft: buildCandidateMessageDraft(candidate),
                      context: 'matching',
                    })}
                    variant="outline-primary"
                  >
                    メッセージを開く
                  </AppButton>
                  {candidate.itemsFromA.concat(candidate.itemsFromB).map((item) => {
                    const key = `${candidate.pharmacyId}:${item.drugName}`;
                    const isBookmarked = bookmarkMap.has(key);
                    const isPending = bookmarkPending.has(key);
                    return (
                      <LoadingButton
                        key={key}
                        variant={isBookmarked ? 'warning' : 'outline-secondary'}
                        size="sm"
                        loading={isPending}
                        loadingLabel="..."
                        onClick={() => void handleToggleBookmark(candidate, item.drugName)}
                        title={isBookmarked ? 'ブックマーク解除' : 'ブックマーク'}
                        aria-label={`${item.drugName} を${isBookmarked ? 'ブックマーク解除' : 'ブックマーク'}`}
                      >
                        {isBookmarked ? '\u2605' : '\u2606'} {item.drugName}
                      </LoadingButton>
                    );
                  })}
                </div>
              </AppCard.Body>
            )}
          </AppCard>
            </SwipeableListItem>
        ))}
        </PullToRefresh>

        {searched && displayCandidates.length > 0 && (
          <SwipeCoachingOverlay featureKey="matching-swipe" />
        )}
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
