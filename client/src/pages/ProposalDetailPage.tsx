import { useState, useEffect } from 'react';
import { Card, Table, Button, Alert, Badge, Row, Col } from 'react-bootstrap';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import DisclaimerBanner from '../components/DisclaimerBanner';

interface PharmacyInfo {
  id: number;
  name: string;
  phone: string;
  fax: string;
  address: string;
  prefecture: string;
}

interface ProposalItem {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  quantity: number;
  yakkaValue: number;
  drugName: string;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface ProposalDetail {
  proposal: {
    id: number;
    pharmacyAId: number;
    pharmacyBId: number;
    status: string;
    totalValueA: number;
    totalValueB: number;
    valueDifference: number;
    proposedAt: string;
  };
  items: ProposalItem[];
  pharmacyA: PharmacyInfo;
  pharmacyB: PharmacyInfo;
}

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchDetail = () => {
    api.get<ProposalDetail>(`/exchange/proposals/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  };

  useEffect(() => { fetchDetail(); }, [id]);

  if (!data) return error ? <Alert variant="danger">{error}</Alert> : null;

  const { proposal, items, pharmacyA, pharmacyB } = data;
  const isA = proposal.pharmacyAId === user?.id;

  const itemsAtoB = items.filter((i) => i.fromPharmacyId === proposal.pharmacyAId);
  const itemsBtoA = items.filter((i) => i.fromPharmacyId === proposal.pharmacyBId);

  // 3-phase: マッチング前 → 仮マッチング → 確定
  const isTentativePhase = ['proposed', 'accepted_a', 'accepted_b'].includes(proposal.status);
  const isConfirmedPhase = proposal.status === 'confirmed';
  const isCompletedPhase = proposal.status === 'completed';
  const isTerminalPhase = ['rejected', 'cancelled'].includes(proposal.status);

  const phaseIndex = isTerminalPhase ? -1
    : isTentativePhase ? 1
    : isConfirmedPhase ? 2
    : isCompletedPhase ? 3
    : 0;

  const statusLabel = proposal.status === 'proposed' ? '仮マッチング中（双方未承認）'
    : proposal.status === 'accepted_a' ? '仮マッチング中（A側承認済）'
    : proposal.status === 'accepted_b' ? '仮マッチング中（B側承認済）'
    : proposal.status === 'confirmed' ? '確定'
    : proposal.status === 'completed' ? '完了'
    : proposal.status === 'rejected' ? '拒否'
    : proposal.status === 'cancelled' ? 'キャンセル'
    : proposal.status;

  const canAccept = (
    (proposal.status === 'proposed') ||
    (proposal.status === 'accepted_a' && !isA) ||
    (proposal.status === 'accepted_b' && isA)
  );
  const canReject = isTentativePhase;
  const canComplete = isConfirmedPhase;

  const handleAction = async (action: 'accept' | 'reject' | 'complete') => {
    const confirmMsg = action === 'accept' ? '承認' : action === 'reject' ? '拒否' : '交換完了';
    if (!confirm(`この仮マッチングを${confirmMsg}しますか？`)) return;
    try {
      const result = await api.post<{ message: string }>(`/exchange/proposals/${id}/${action}`);
      setMessage(result.message);
      fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました');
    }
  };

  return (
    <div>
      <DisclaimerBanner />
      <div className="d-flex justify-content-between align-items-center mb-3 mobile-card-header">
        <h4 className="page-title mb-0">マッチング #{proposal.id}</h4>
        <Link to={`/proposals/${id}/print`} className="btn btn-outline-secondary btn-sm" target="_blank">
          印刷用ページ
        </Link>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      {/* 3-phase progress indicator */}
      <Card className="mb-3">
        <Card.Body className="py-2">
          <div className="d-flex align-items-center justify-content-between small">
            {[
              { label: '仮マッチング', phase: 1 },
              { label: '確定', phase: 2 },
              { label: '完了', phase: 3 },
            ].map((step, i) => (
              <div key={step.phase} className="d-flex align-items-center flex-grow-1">
                <div
                  className={`rounded-circle d-flex align-items-center justify-content-center ${
                    isTerminalPhase ? 'bg-secondary'
                    : phaseIndex >= step.phase ? 'bg-success' : 'bg-light border'
                  }`}
                  style={{ width: 28, height: 28, minWidth: 28, color: isTerminalPhase || phaseIndex >= step.phase ? '#fff' : '#999' }}
                >
                  {isTerminalPhase ? '—' : phaseIndex >= step.phase ? '✓' : step.phase}
                </div>
                <span className={`ms-1 ${phaseIndex >= step.phase && !isTerminalPhase ? 'fw-bold' : 'text-muted'}`}>
                  {step.label}
                </span>
                {i < 2 && <div className={`flex-grow-1 mx-2 ${phaseIndex > step.phase && !isTerminalPhase ? 'border-success' : ''}`} style={{ borderBottom: '2px solid #dee2e6', borderColor: phaseIndex > step.phase && !isTerminalPhase ? '#198754' : undefined }} />}
              </div>
            ))}
          </div>
          <div className="text-center mt-1 small text-muted">
            現在のステータス: <Badge bg={isTerminalPhase ? 'danger' : isCompletedPhase ? 'secondary' : isConfirmedPhase ? 'success' : 'warning'}>{statusLabel}</Badge>
          </div>
        </Card.Body>
      </Card>

      <Row className="g-3 mb-3">
        <Col md={6}>
          <Card>
            <Card.Header>{pharmacyA.name} (A)</Card.Header>
            <Card.Body className="small">
              <p>{pharmacyA.prefecture} {pharmacyA.address}</p>
              <p>TEL: {pharmacyA.phone} / FAX: {pharmacyA.fax}</p>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card>
            <Card.Header>{pharmacyB.name} (B)</Card.Header>
            <Card.Body className="small">
              <p>{pharmacyB.prefecture} {pharmacyB.address}</p>
              <p>TEL: {pharmacyB.phone} / FAX: {pharmacyB.fax}</p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="mb-3">
        <Card.Header>交換手順（3フェーズ）</Card.Header>
        <Card.Body className="small">
          <ol className="mb-0">
            <li><strong>仮マッチング:</strong> 印刷用ページから交換様式を印刷し、提案元が署名/押印後に相手先FAXへ送信します。</li>
            <li><strong>双方承認:</strong> 受信側は同意欄を記入してFAX返信し、双方がシステム上で「承認」します。</li>
            <li><strong>確定→完了:</strong> 双方承認で確定となります。受け渡し完了後に「交換完了」を実行します。</li>
          </ol>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Header>
          <strong>{pharmacyA.name}</strong> → <strong>{pharmacyB.name}</strong>
          <Badge bg="primary" className="ms-2">{proposal.totalValueA?.toLocaleString()}円</Badge>
        </Card.Header>
        <Card.Body>
          <div className="table-responsive">
            <Table size="sm" striped className="mobile-table">
              <thead><tr><th>薬品名</th><th>数量</th><th>単位</th><th>薬価(単価)</th><th>薬価(合計)</th></tr></thead>
              <tbody>
                {itemsAtoB.map((item) => (
                  <tr key={item.id}>
                    <td>{item.drugName}</td><td>{item.quantity}</td><td>{item.unit}</td>
                    <td>{item.yakkaUnitPrice?.toLocaleString()}</td><td>{item.yakkaValue?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Header>
          <strong>{pharmacyB.name}</strong> → <strong>{pharmacyA.name}</strong>
          <Badge bg="primary" className="ms-2">{proposal.totalValueB?.toLocaleString()}円</Badge>
        </Card.Header>
        <Card.Body>
          <div className="table-responsive">
            <Table size="sm" striped className="mobile-table">
              <thead><tr><th>薬品名</th><th>数量</th><th>単位</th><th>薬価(単価)</th><th>薬価(合計)</th></tr></thead>
              <tbody>
                {itemsBtoA.map((item) => (
                  <tr key={item.id}>
                    <td>{item.drugName}</td><td>{item.quantity}</td><td>{item.unit}</td>
                    <td>{item.yakkaUnitPrice?.toLocaleString()}</td><td>{item.yakkaValue?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      <div className="d-flex gap-2 mobile-stack">
        {canAccept && <Button variant="success" onClick={() => handleAction('accept')}>仮マッチングを承認</Button>}
        {canReject && <Button variant="danger" onClick={() => handleAction('reject')}>拒否する</Button>}
        {canComplete && <Button variant="primary" onClick={() => handleAction('complete')}>交換完了</Button>}
      </div>
    </div>
  );
}
