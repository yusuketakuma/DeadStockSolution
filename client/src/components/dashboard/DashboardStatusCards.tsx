import { Card, Row, Col, Alert, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { UploadStatus } from './types';

interface Props {
  status: UploadStatus | null;
  userName: string | null | undefined;
}

export default function DashboardStatusCards({ status, userName }: Props) {
  return (
    <>
      <p>ようこそ、{userName} さん</p>

      <Row className="g-3">
        <Col md={6} lg={4}>
          <Card>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <Card.Title className="mb-0">デッドストックリスト</Card.Title>
                {status?.lastDeadStockUpload && (
                  <small className="text-muted">最終: {new Date(status.lastDeadStockUpload).toLocaleDateString('ja-JP')}</small>
                )}
              </div>
              <Card.Text className="mt-2">
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
              <div className="d-flex justify-content-between align-items-start">
                <Card.Title className="mb-0">医薬品使用量リスト</Card.Title>
                {status?.lastUsedMedicationUpload && (
                  <small className="text-muted">最終: {new Date(status.lastUsedMedicationUpload).toLocaleDateString('ja-JP')}</small>
                )}
              </div>
              <Card.Text className="mt-2">
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
                  ? 'デッドストックリストの交換先を検索できます'
                  : '医薬品使用量リストのアップロードが必要です'}
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
              <Card.Title>マッチング状況</Card.Title>
              <Card.Text>仮マッチング・確定済みの一覧を確認</Card.Text>
              <Link to="/proposals" className="btn btn-outline-primary btn-sm">マッチング一覧</Link>
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
          マッチング機能を利用するには、当月の医薬品使用量Excelをアップロードしてください。
        </Alert>
      )}
    </>
  );
}
