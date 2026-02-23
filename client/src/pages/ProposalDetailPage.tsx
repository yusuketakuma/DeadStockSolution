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

  const canAccept = (
    (proposal.status === 'proposed') ||
    (proposal.status === 'accepted_a' && !isA) ||
    (proposal.status === 'accepted_b' && isA)
  );
  const canReject = ['proposed', 'accepted_a', 'accepted_b'].includes(proposal.status);
  const canComplete = proposal.status === 'confirmed';

  const handleAction = async (action: 'accept' | 'reject' | 'complete') => {
    const confirmMsg = action === 'accept' ? '承認' : action === 'reject' ? '拒否' : '完了';
    if (!confirm(`この提案を${confirmMsg}しますか？`)) return;
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
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>交換提案 #{proposal.id}</h4>
        <Link to={`/proposals/${id}/print`} className="btn btn-outline-secondary btn-sm" target="_blank">
          印刷用ページ
        </Link>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

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
        <Card.Header>
          <strong>{pharmacyA.name}</strong> → <strong>{pharmacyB.name}</strong>
          <Badge bg="primary" className="ms-2">{proposal.totalValueA?.toLocaleString()}円</Badge>
        </Card.Header>
        <Card.Body>
          <Table size="sm" striped>
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
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Header>
          <strong>{pharmacyB.name}</strong> → <strong>{pharmacyA.name}</strong>
          <Badge bg="primary" className="ms-2">{proposal.totalValueB?.toLocaleString()}円</Badge>
        </Card.Header>
        <Card.Body>
          <Table size="sm" striped>
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
        </Card.Body>
      </Card>

      <div className="d-flex gap-2">
        {canAccept && <Button variant="success" onClick={() => handleAction('accept')}>承認</Button>}
        {canReject && <Button variant="danger" onClick={() => handleAction('reject')}>拒否</Button>}
        {canComplete && <Button variant="primary" onClick={() => handleAction('complete')}>交換完了</Button>}
      </div>
    </div>
  );
}
