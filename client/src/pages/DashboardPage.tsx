import { useState, useEffect } from 'react';
import { Card, Row, Col, Alert, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import DisclaimerBanner from '../components/DisclaimerBanner';

interface UploadStatus {
  deadStockUploaded: boolean;
  usedMedicationUploaded: boolean;
  lastDeadStockUpload: string | null;
  lastUsedMedicationUpload: string | null;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<UploadStatus | null>(null);

  useEffect(() => {
    api.get<UploadStatus>('/upload/status').then(setStatus).catch(() => {});
  }, []);

  return (
    <div>
      <DisclaimerBanner />
      <h4 className="mb-3">ダッシュボード</h4>
      <p>ようこそ、{user?.name} さん</p>

      <Row className="g-3">
        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>不動在庫</Card.Title>
              <Card.Text>
                {status?.deadStockUploaded
                  ? <Badge bg="success">アップロード済み</Badge>
                  : <Badge bg="secondary">未アップロード</Badge>}
              </Card.Text>
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              {' '}
              <Link to="/inventory/dead-stock" className="btn btn-outline-secondary btn-sm">一覧を見る</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>使用薬剤</Card.Title>
              <Card.Text>
                {status?.usedMedicationUploaded
                  ? <Badge bg="success">当月アップロード済み</Badge>
                  : <Badge bg="warning" text="dark">当月未アップロード</Badge>}
              </Card.Text>
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              {' '}
              <Link to="/inventory/used-medication" className="btn btn-outline-secondary btn-sm">一覧を見る</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>マッチング</Card.Title>
              <Card.Text>
                {status?.usedMedicationUploaded
                  ? '不動在庫の交換先を検索できます'
                  : '使用薬剤のアップロードが必要です'}
              </Card.Text>
              <Link
                to="/matching"
                className={`btn btn-sm ${status?.usedMedicationUploaded ? 'btn-primary' : 'btn-secondary disabled'}`}
              >
                マッチングを実行
              </Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>在庫参照</Card.Title>
              <Card.Text>全薬局の医薬品在庫を検索・閲覧</Card.Text>
              <Link to="/inventory/browse" className="btn btn-outline-primary btn-sm">在庫を検索</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>交換提案</Card.Title>
              <Card.Text>受信・送信した交換提案を確認</Card.Text>
              <Link to="/proposals" className="btn btn-outline-primary btn-sm">提案一覧</Link>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title>交換履歴</Card.Title>
              <Card.Text>過去の交換記録を確認</Card.Text>
              <Link to="/exchange-history" className="btn btn-outline-primary btn-sm">履歴を見る</Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {!status?.usedMedicationUploaded && (
        <Alert variant="info" className="mt-3">
          マッチング機能を利用するには、当月の使用薬剤Excelをアップロードしてください。
        </Alert>
      )}
    </div>
  );
}
