import { useMemo, useState } from 'react';
import { useAsyncState } from '../hooks/useAsyncState';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { Badge, Row, Col } from 'react-bootstrap';
import { api } from '../api/client';
import RequireUpload from '../components/RequireUpload';
import { markMatchingDone, readOnboardingMatchingDone } from '../components/onboarding/onboardingSteps';
import { useAuth } from '../contexts/AuthContext';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';
import ConfirmActionModal from '../components/ConfirmActionModal';
import LoadingButton from '../components/ui/LoadingButton';
import AppCard from '../components/ui/AppCard';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import { useSearchParams } from 'react-router-dom';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

interface MatchItem {
  deadStockItemId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number;
  yakkaValue: number;
  expirationDate?: string | null;
  matchScore?: number;
}

interface MatchCandidate {
  pharmacyId: number;
  pharmacyName: string;
  pharmacyPhone?: string | null;
  pharmacyFax?: string | null;
  distance: number;
  itemsFromA: MatchItem[];
  itemsFromB: MatchItem[];
  totalValueA: number;
  totalValueB: number;
  valueDifference: number;
  score?: number;
  matchRate?: number;
  businessStatus?: BusinessHoursStatus;
  isFavorite?: boolean;
}

function formatPercent(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
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
  const [searchParams] = useSearchParams();
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const { loading, setLoading, error, setError, message, setMessage } = useAsyncState();
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [proposalRetrySuggested, setProposalRetrySuggested] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [candidateForProposal, setCandidateForProposal] = useState<MatchCandidate | null>(null);
  const requestedDrug = (searchParams.get('drug') ?? '').trim();

  const displayCandidates = useMemo(() => {
    const needle = requestedDrug.toLowerCase();
    if (!needle) {
      return candidates;
    }
    return candidates.filter((candidate) =>
      candidate.itemsFromA.some((item) => item.drugName.toLowerCase().includes(needle))
      || candidate.itemsFromB.some((item) => item.drugName.toLowerCase().includes(needle)),
    );
  }, [candidates, requestedDrug]);

  const handleSearch = async () => {
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
  };

  const handleSendProposal = async () => {
    if (!candidateForProposal) return;
    setProposalSubmitting(true);
    setProposalRetrySuggested(false);
    try {
      await api.post('/exchange/proposals', { candidate: candidateForProposal });
      setMessage(`${candidateForProposal.pharmacyName}との仮マッチングを開始しました。相手薬局の承認をお待ちください。`);
      setCandidates((prev) => prev.filter((c) => c.pharmacyId !== candidateForProposal.pharmacyId));
      setCandidateForProposal(null);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : '仮マッチングの送信に失敗しました';
      setError(messageText);
      setProposalRetrySuggested(
        messageText.includes('在庫')
        || messageText.includes('数量')
        || messageText.includes('利用可能')
      );
    } finally {
      setProposalSubmitting(false);
    }
  };

  return (
    <RequireUpload>
      <PageShell>
        <h4 className="page-title mb-3">マッチング</h4>
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
        {requestedDrug && (
          <AppAlert variant="info" className="small">
            対象薬剤: <strong>{requestedDrug}</strong>（一致候補を優先表示）
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

        {searched && candidates.length === 0 && !loading && (
          <AppAlert variant="info">
            交換候補が見つかりませんでした。アップロード内容を更新後、再実行してください。
          </AppAlert>
        )}
        {searched && candidates.length > 0 && displayCandidates.length === 0 && requestedDrug && !loading && (
          <AppAlert variant="warning">
            「{requestedDrug}」に一致する候補は見つかりませんでした。クエリを外すと全候補を確認できます。
          </AppAlert>
        )}

        <ScrollArea>
        {displayCandidates.map((candidate, idx) => (
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

                <div className="d-flex gap-2 mobile-stack">
                  <LoadingButton variant="success" onClick={() => setCandidateForProposal(candidate)} loading={proposalSubmitting} loadingLabel="提案中...">
                    仮マッチングする
                  </LoadingButton>
                </div>
              </AppCard.Body>
            )}
          </AppCard>
        ))}
        </ScrollArea>

        <ConfirmActionModal
          show={candidateForProposal !== null}
          title="仮マッチングの開始"
          body={candidateForProposal ? (
            <>
              <div className="mb-2">以下の薬局との仮マッチングを開始します。</div>
              <div className="small text-muted">
                対象: {candidateForProposal.pharmacyName}
                <br />
                双方の承認後に確定します。
              </div>
            </>
          ) : null}
          confirmLabel="仮マッチングを開始"
          confirmVariant="success"
          onCancel={() => setCandidateForProposal(null)}
          onConfirm={handleSendProposal}
          pending={proposalSubmitting}
        />
      </PageShell>
    </RequireUpload>
  );
}
