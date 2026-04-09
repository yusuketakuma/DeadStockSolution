import { Badge, Col, Row } from 'react-bootstrap';
import type { MatchCandidate, MatchItem } from '../../types/matching';
import { buildMessagesPath } from '../../utils/message-links';
import AppAlert from '../ui/AppAlert';
import AppButton from '../ui/AppButton';
import AppCard from '../ui/AppCard';
import AppMobileDataCard from '../ui/AppMobileDataCard';
import AppResponsiveSwitch from '../ui/AppResponsiveSwitch';
import AppTable from '../ui/AppTable';
import AppDropdownMenu from '../ui/AppDropdownMenu';
import BusinessStatusBadge from '../BusinessStatusBadge';
import LoadingButton from '../ui/LoadingButton';
import PullToRefresh from '../gesture/PullToRefresh';
import SwipeableListItem from '../gesture/SwipeableListItem';
import SwipeCoachingOverlay from '../gesture/SwipeCoachingOverlay';
import MatchCandidateInsightsPanel from './MatchCandidateInsightsPanel';

function formatPercent(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

function buildCandidateMessageDraft(candidate: MatchCandidate): string {
  const focusDrugs = candidate.itemsFromA
    .slice(0, 3)
    .map((item) => item.drugName)
    .join(' / ');
  return `マッチング候補 #${candidate.pharmacyId} について相談したいです。候補薬剤: ${focusDrugs || '候補明細を確認中'}。`;
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

interface MatchCandidateCardProps {
  candidate: MatchCandidate;
  expanded: boolean;
  compareSelected: boolean;
  compareDisabled: boolean;
  groupPharmacyIds: Set<number>;
  proposalSubmitting: boolean;
  bookmarkMap: Map<string, number>;
  bookmarkPending: Set<string>;
  onToggleExpanded: () => void;
  onDismiss: () => void;
  onOpenProposal: () => void;
  onToggleCompare: () => void;
  onToggleBookmark: (candidate: MatchCandidate, drugCode: string) => Promise<void> | void;
}

function MatchCandidateCard({
  candidate,
  expanded,
  compareSelected,
  compareDisabled,
  groupPharmacyIds,
  proposalSubmitting,
  bookmarkMap,
  bookmarkPending,
  onToggleExpanded,
  onDismiss,
  onOpenProposal,
  onToggleCompare,
  onToggleBookmark,
}: MatchCandidateCardProps) {
  const bookmarkItems = candidate.itemsFromA.concat(candidate.itemsFromB)
    .map((item) => {
      const bookmarkCode = item.drugCode?.trim();
      if (!bookmarkCode) return null;
      const key = `${candidate.pharmacyId}:${bookmarkCode}`;
      const isBookmarked = bookmarkMap.has(key);
      const isPending = bookmarkPending.has(key);
      return {
        key,
        label: `${isBookmarked ? '★' : '☆'} ${item.drugName}`,
        onClick: () => {
          if (!isPending) {
            void onToggleBookmark(candidate, bookmarkCode);
          }
        },
        disabled: isPending,
      };
    })
    .filter((item): item is { key: string; label: string; onClick: () => void; disabled: boolean } => item !== null);

  return (
    <SwipeableListItem
      onSwipeLeft={onDismiss}
      onSwipeRight={onOpenProposal}
      leftContent={<div className="swipe-bg-reject"><span className="swipe-icon" aria-hidden="true">{'\u2715'}</span> 拒否</div>}
      rightContent={<div className="swipe-bg-approve"><span className="swipe-icon" aria-hidden="true">{'\u2713'}</span> 承認</div>}
      undoDuration={5000}
    >
      <AppCard className="mb-3">
        <AppCard.Header className="p-0">
          <AppButton
            type="button"
            variant="link"
            className="match-candidate-toggle w-100 d-flex justify-content-between align-items-center mobile-card-header"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={`candidate-panel-${candidate.pharmacyId}`}
          >
            <span>
              <strong>{candidate.pharmacyName}</strong>
              {candidate.isFavorite && <Badge bg="warning" text="dark" className="ms-2">お気に入り</Badge>}
              {compareSelected && <Badge bg="primary" className="ms-2">比較中</Badge>}
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

        {expanded && (
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

            <AppResponsiveSwitch
              desktop={() => (
                <div className="d-flex gap-2 mobile-stack flex-wrap">
                  <LoadingButton variant="success" onClick={onOpenProposal} loading={proposalSubmitting} loadingLabel="提案中...">
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
                  <AppButton
                    type="button"
                    variant={compareSelected ? 'primary' : 'outline-secondary'}
                    disabled={compareDisabled}
                    onClick={onToggleCompare}
                  >
                    {compareSelected ? '比較から外す' : '比較に追加'}
                  </AppButton>
                  {bookmarkItems.map((item) => (
                    <LoadingButton
                      key={item.key}
                      variant={item.label.startsWith('★') ? 'warning' : 'outline-secondary'}
                      size="sm"
                      loading={item.disabled}
                      loadingLabel="..."
                      onClick={item.onClick}
                    >
                      {item.label}
                    </LoadingButton>
                  ))}
                </div>
              )}
              mobile={() => (
                <div className="d-flex gap-2 flex-wrap">
                  <LoadingButton variant="success" onClick={onOpenProposal} loading={proposalSubmitting} loadingLabel="提案中..." className="flex-grow-1">
                    仮マッチングする
                  </LoadingButton>
                  <AppDropdownMenu
                    label="その他"
                    items={[
                      {
                        key: 'message',
                        label: 'メッセージを開く',
                        href: buildMessagesPath({
                          pharmacyId: candidate.pharmacyId,
                          pharmacyName: candidate.pharmacyName,
                          draft: buildCandidateMessageDraft(candidate),
                          context: 'matching',
                        }),
                      },
                      {
                        key: 'compare',
                        label: compareSelected ? '比較から外す' : '比較に追加',
                        onClick: onToggleCompare,
                        disabled: compareDisabled,
                      },
                      {
                        key: 'dismiss',
                        label: '候補から外す',
                        onClick: onDismiss,
                        danger: true,
                      },
                      ...bookmarkItems,
                    ]}
                  />
                </div>
              )}
            />
          </AppCard.Body>
        )}
      </AppCard>
    </SwipeableListItem>
  );
}

interface MatchingResultsListProps {
  searched: boolean;
  loading: boolean;
  candidatesCount: number;
  displayCandidates: MatchCandidate[];
  requestedDrugTerms: string[];
  requestedDrugLabel: string;
  requestedTargetPharmacyId: number | null;
  groupPharmacyIds: Set<number>;
  expandedIdx: number | null;
  comparePharmacyIds: number[];
  proposalSubmitting: boolean;
  bookmarkMap: Map<string, number>;
  bookmarkPending: Set<string>;
  onToggleExpanded: (idx: number) => void;
  onDismissCandidate: (candidate: MatchCandidate) => void;
  onOpenProposal: (candidate: MatchCandidate) => void;
  onToggleCompareCandidate: (candidate: MatchCandidate) => void;
  onToggleBookmark: (candidate: MatchCandidate, drugCode: string) => Promise<void> | void;
  onRefresh: () => Promise<void>;
  onShowAllCandidates: () => void;
}

export default function MatchingResultsList({
  searched,
  loading,
  candidatesCount,
  displayCandidates,
  requestedDrugTerms,
  requestedDrugLabel,
  requestedTargetPharmacyId,
  groupPharmacyIds,
  expandedIdx,
  comparePharmacyIds,
  proposalSubmitting,
  bookmarkMap,
  bookmarkPending,
  onToggleExpanded,
  onDismissCandidate,
  onOpenProposal,
  onToggleCompareCandidate,
  onToggleBookmark,
  onRefresh,
  onShowAllCandidates,
}: MatchingResultsListProps) {
  return (
    <>
      {searched && candidatesCount === 0 && !loading && (
        <AppAlert variant="info">
          交換候補が見つかりませんでした。アップロード内容を更新後、再実行してください。
        </AppAlert>
      )}
      {searched && candidatesCount > 0 && displayCandidates.length === 0 && requestedDrugTerms.length > 0 && !loading && (
        <AppAlert variant="warning">
          「{requestedDrugLabel}」に一致する候補は見つかりませんでした。クエリを外すと全候補を確認できます。
        </AppAlert>
      )}
      {searched && candidatesCount > 0 && displayCandidates.length === 0 && requestedTargetPharmacyId !== null && !loading && (
        <AppAlert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <span>選択した薬局は現在マッチング候補にありません。全候補を表示して他の候補を確認できます。</span>
          <AppButton type="button" variant="outline-warning" size="sm" onClick={onShowAllCandidates}>
            全候補を表示
          </AppButton>
        </AppAlert>
      )}

      <PullToRefresh onRefresh={onRefresh} disabled={!searched}>
        {displayCandidates.map((candidate, idx) => (
          <MatchCandidateCard
            key={`candidate-${candidate.pharmacyId}`}
            candidate={candidate}
            expanded={expandedIdx === idx}
            compareSelected={comparePharmacyIds.includes(candidate.pharmacyId)}
            compareDisabled={comparePharmacyIds.length >= 2 && !comparePharmacyIds.includes(candidate.pharmacyId)}
            groupPharmacyIds={groupPharmacyIds}
            proposalSubmitting={proposalSubmitting}
            bookmarkMap={bookmarkMap}
            bookmarkPending={bookmarkPending}
            onToggleExpanded={() => onToggleExpanded(idx)}
            onDismiss={() => onDismissCandidate(candidate)}
            onOpenProposal={() => onOpenProposal(candidate)}
            onToggleCompare={() => onToggleCompareCandidate(candidate)}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </PullToRefresh>

      {searched && displayCandidates.length > 0 && (
        <SwipeCoachingOverlay featureKey="matching-swipe" />
      )}
    </>
  );
}
