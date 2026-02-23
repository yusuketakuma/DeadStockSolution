import { useState } from 'react';
import { Card, Button, Alert, Table, Badge, Spinner } from 'react-bootstrap';
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
}

interface MatchCandidate {
  pharmacyId: number;
  pharmacyName: string;
  distance: number;
  itemsFromA: MatchItem[];
  itemsFromB: MatchItem[];
  totalValueA: number;
  totalValueB: number;
  valueDifference: number;
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
        <h4 className="mb-3">マッチング</h4>
        {error && <Alert variant="danger">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}

        <Card className="mb-3">
          <Card.Body>
            <p>あなたの不動在庫を使用している薬局を検索し、双方向の交換候補を見つけます。</p>
            <Button onClick={handleSearch} disabled={loading} variant="primary">
              {loading ? <><Spinner size="sm" /> マッチング中...</> : 'マッチングを実行'}
            </Button>
          </Card.Body>
        </Card>

        {searched && candidates.length === 0 && !loading && (
          <Alert variant="info">
            現在、交換可能な薬局が見つかりませんでした。条件（薬価合計1万円以上、差額10円以内）に合致するペアがありません。
          </Alert>
        )}

        {candidates.map((c, idx) => (
          <Card key={c.pharmacyId} className="mb-3">
            <Card.Header
              className="d-flex justify-content-between align-items-center"
              style={{ cursor: 'pointer' }}
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            >
              <div>
                <strong>{c.pharmacyName}</strong>
                <Badge bg="info" className="ms-2">{c.distance}km</Badge>
              </div>
              <div>
                <span className="text-muted me-3">
                  合計: {c.totalValueA.toLocaleString()}円 / {c.totalValueB.toLocaleString()}円
                </span>
                <Badge bg={c.valueDifference <= 10 ? 'success' : 'warning'}>
                  差額: {c.valueDifference}円
                </Badge>
              </div>
            </Card.Header>

            {expandedIdx === idx && (
              <Card.Body>
                <h6>あなた → {c.pharmacyName} ({c.totalValueA.toLocaleString()}円)</h6>
                <Table size="sm" striped className="mb-3">
                  <thead><tr><th>薬品名</th><th>数量</th><th>単位</th><th>薬価(単価)</th><th>薬価(合計)</th></tr></thead>
                  <tbody>
                    {c.itemsFromA.map((item, i) => (
                      <tr key={i}>
                        <td>{item.drugName}</td>
                        <td>{item.quantity}</td>
                        <td>{item.unit}</td>
                        <td>{item.yakkaUnitPrice.toLocaleString()}</td>
                        <td>{item.yakkaValue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <h6>{c.pharmacyName} → あなた ({c.totalValueB.toLocaleString()}円)</h6>
                <Table size="sm" striped className="mb-3">
                  <thead><tr><th>薬品名</th><th>数量</th><th>単位</th><th>薬価(単価)</th><th>薬価(合計)</th></tr></thead>
                  <tbody>
                    {c.itemsFromB.map((item, i) => (
                      <tr key={i}>
                        <td>{item.drugName}</td>
                        <td>{item.quantity}</td>
                        <td>{item.unit}</td>
                        <td>{item.yakkaUnitPrice.toLocaleString()}</td>
                        <td>{item.yakkaValue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <Button variant="success" onClick={() => handleSendProposal(c)}>
                  この薬局に提案を送る
                </Button>
              </Card.Body>
            )}
          </Card>
        ))}
      </div>
    </RequireUpload>
  );
}
