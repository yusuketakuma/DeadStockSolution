import { useState } from 'react';
import { Card, Button, Alert, Table, Badge, Spinner, Row, Col } from 'react-bootstrap';
import { api } from '../api/client';
import RequireUpload from '../components/RequireUpload';
import DisclaimerBanner from '../components/DisclaimerBanner';

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
}

function formatPercent(value?: number): string {
  if (!value || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

export default function MatchingPage() {
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setMessage('');
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

  const handleSendProposal = async (candidate: MatchCandidate) => {
    if (!confirm(`${candidate.pharmacyName}に交換提案を送信しますか？`)) return;
    try {
      await api.post('/exchange/proposals', { candidate });
      setMessage(`${candidate.pharmacyName}に交換提案を送信しました`);
      setCandidates((prev) => prev.filter((c) => c.pharmacyId !== candidate.pharmacyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '提案の送信に失敗しました');
    }
  };

  return (
    <RequireUpload>
      <div>
        <DisclaimerBanner />
        <h4 className="page-title mb-3">マッチング</h4>
        {error && <Alert variant="danger">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}

        <Card className="mb-3">
          <Card.Body>
            <p className="mb-2">
              不動在庫と使用薬剤の一致度・距離・金額バランスをもとに、交換候補を優先順位付きで表示します。
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
            <Card.Header
              className="d-flex justify-content-between align-items-center mobile-card-header"
              style={{ cursor: 'pointer' }}
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            >
              <div>
                <strong>{candidate.pharmacyName}</strong>
                <div className="small text-muted">
                  TEL: {candidate.pharmacyPhone || '-'} / FAX: {candidate.pharmacyFax || '-'}
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Badge bg="info">{candidate.distance}km</Badge>
                <Badge bg="secondary">一致度 {formatPercent(candidate.matchRate)}</Badge>
                <Badge bg="primary">総合 {candidate.score?.toFixed(1) ?? '-'}</Badge>
                <Badge bg={candidate.valueDifference <= 10 ? 'success' : 'warning'}>
                  差額 {candidate.valueDifference}円
                </Badge>
              </div>
            </Card.Header>

            {expandedIdx === idx && (
              <Card.Body>
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
                      <li>本内容を印刷し、提案元薬局が同意欄に記入・押印します。</li>
                      <li>提案元薬局から相手薬局のFAXへ送信します（送信先: {candidate.pharmacyFax || '相手薬局に確認'}）。</li>
                      <li>相手薬局は内容確認後、同意欄に記入してFAX返信します。</li>
                      <li>双方の同意後、システム上で「承認」し、受け渡し完了後に「交換完了」を実行します。</li>
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
                            <td style={{ minWidth: '180px' }}></td>
                            <td style={{ minWidth: '130px' }}></td>
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
                  <Button variant="success" onClick={() => handleSendProposal(candidate)}>
                    この薬局に提案を送る
                  </Button>
                </div>
              </Card.Body>
            )}
          </Card>
        ))}
      </div>
    </RequireUpload>
  );
}
