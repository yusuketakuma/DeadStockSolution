import { useState } from 'react';
import { Card, Button, Alert, Table, Badge, Spinner, Row, Col } from 'react-bootstrap';
import { api } from '../api/client';
import RequireUpload from '../components/RequireUpload';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';
import ConfirmActionModal from '../components/ConfirmActionModal';

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
  if (!value || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

export default function MatchingPage() {
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [proposalRetrySuggested, setProposalRetrySuggested] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [candidateForProposal, setCandidateForProposal] = useState<MatchCandidate | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    setProposalRetrySuggested(false);
    try {
      const data = await api.post<{ candidates: MatchCandidate[] }>('/exchange/find');
      setCandidates(data.candidates);
      setSearched(true);
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
      <div>
        <h4 className="page-title mb-3">マッチング</h4>
        {error && <Alert variant="danger">{error}</Alert>}
        {proposalRetrySuggested && (
          <Alert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <span className="small">在庫状態が更新された可能性があります。最新条件で再マッチングしてください。</span>
            <Button size="sm" variant="outline-warning" onClick={handleSearch} disabled={loading}>
              {loading ? '再実行中...' : '再マッチング'}
            </Button>
          </Alert>
        )}
        {message && <Alert variant="success">{message}</Alert>}

        <Card className="mb-3">
          <Card.Body>
            <p className="mb-2">
              デッドストックリストと医薬品使用量リストの一致度・距離・金額バランスをもとに、交換候補を優先順位付きで表示します。
            </p>
            <div className="small text-muted mb-3">
              条件: 双方1万円以上 / 差額10円以内
            </div>
            <Button onClick={handleSearch} disabled={loading} variant="primary">
              {loading ? <><Spinner size="sm" className="me-1" /> マッチング中...</> : 'マッチングを実行'}
            </Button>
          </Card.Body>
        </Card>

        {searched && candidates.length === 0 && !loading && (
          <Alert variant="info">
            交換候補が見つかりませんでした。アップロード内容を更新後、再実行してください。
          </Alert>
        )}

        {candidates.map((candidate, idx) => (
          <Card key={candidate.pharmacyId} className="mb-3">
            <Card.Header className="p-0">
              <button
                type="button"
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
              </button>
            </Card.Header>

            {expandedIdx === idx && (
              <Card.Body id={`candidate-panel-${candidate.pharmacyId}`}>
                {candidate.businessStatus?.closingSoon && (
                  <Alert variant="warning" className="py-2 mb-3">
                    この薬局はまもなく営業終了です（本日 {candidate.businessStatus.todayHours?.closeTime} まで）
                  </Alert>
                )}
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <h6>あなた → {candidate.pharmacyName} ({candidate.totalValueA.toLocaleString()}円)</h6>
                    <div className="table-responsive">
                      <Table size="sm" striped className="mb-0 mobile-table">
                        <thead>
                          <tr>
                            <th>薬品名</th>
                            <th>数量</th>
                            <th>単位</th>
                            <th className="mobile-hide">使用期限</th>
                            <th>薬価(単価)</th>
                            <th>薬価(合計)</th>
                            <th>一致度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidate.itemsFromA.map((item, itemIdx) => (
                            <tr key={itemIdx}>
                              <td>{item.drugName}</td>
                              <td>{item.quantity}</td>
                              <td>{item.unit || '-'}</td>
                              <td className="mobile-hide">{item.expirationDate || '-'}</td>
                              <td>{item.yakkaUnitPrice.toLocaleString()}</td>
                              <td>{item.yakkaValue.toLocaleString()}</td>
                              <td>{formatPercent((item.matchScore ?? 0) * 100)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </Col>
                  <Col md={6}>
                    <h6>{candidate.pharmacyName} → あなた ({candidate.totalValueB.toLocaleString()}円)</h6>
                    <div className="table-responsive">
                      <Table size="sm" striped className="mb-0 mobile-table">
                        <thead>
                          <tr>
                            <th>薬品名</th>
                            <th>数量</th>
                            <th>単位</th>
                            <th className="mobile-hide">使用期限</th>
                            <th>薬価(単価)</th>
                            <th>薬価(合計)</th>
                            <th>一致度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidate.itemsFromB.map((item, itemIdx) => (
                            <tr key={itemIdx}>
                              <td>{item.drugName}</td>
                              <td>{item.quantity}</td>
                              <td>{item.unit || '-'}</td>
                              <td className="mobile-hide">{item.expirationDate || '-'}</td>
                              <td>{item.yakkaUnitPrice.toLocaleString()}</td>
                              <td>{item.yakkaValue.toLocaleString()}</td>
                              <td>{formatPercent((item.matchScore ?? 0) * 100)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </Col>
                </Row>

                <Card className="mb-3">
                  <Card.Header className="py-2">
                    交換様式（FAX送信用）
                  </Card.Header>
                  <Card.Body className="small">
                    <ol className="mb-3">
                      <li>「仮マッチングする」ボタンで仮マッチングを開始します。</li>
                      <li>本内容を印刷し、提案元薬局が同意欄に記入・押印後、相手薬局のFAXへ送信します（送信先: {candidate.pharmacyFax || '相手薬局に確認'}）。</li>
                      <li>相手薬局は内容確認後、同意欄を記入してFAX返信します。</li>
                      <li>双方がシステム上で「承認」すると仮マッチングが確定となります。</li>
                      <li>受け渡し完了後に「交換完了」を実行します。</li>
                    </ol>
                    <div className="table-responsive">
                      <Table bordered size="sm" className="mb-0 mobile-table">
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
                      </Table>
                    </div>
                  </Card.Body>
                </Card>

                <div className="d-flex gap-2 mobile-stack">
                  <Button variant="success" onClick={() => setCandidateForProposal(candidate)}>
                    仮マッチングする
                  </Button>
                </div>
              </Card.Body>
            )}
          </Card>
        ))}

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
      </div>
    </RequireUpload>
  );
}
