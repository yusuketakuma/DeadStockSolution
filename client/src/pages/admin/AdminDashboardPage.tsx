import { useState, useEffect } from 'react';
import { Card, Row, Col } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

interface Stats {
  totalPharmacies: number;
  totalUploads: number;
  totalProposals: number;
  totalExchanges: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>('/admin/stats').then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <h4 className="mb-3">管理者ダッシュボード</h4>
      <Row className="g-3">
        <Col md={3}>
          <Card className="text-center">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalPharmacies ?? '-'}</Card.Title>
              <Card.Text>登録薬局数</Card.Text>
              <Link to="/admin/pharmacies" className="btn btn-sm btn-outline-primary">一覧を見る</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalUploads ?? '-'}</Card.Title>
              <Card.Text>アップロード数</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalProposals ?? '-'}</Card.Title>
              <Card.Text>交換提案数</Card.Text>
              <Link to="/admin/exchanges" className="btn btn-sm btn-outline-primary">一覧を見る</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalExchanges ?? '-'}</Card.Title>
              <Card.Text>交換完了数</Card.Text>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
