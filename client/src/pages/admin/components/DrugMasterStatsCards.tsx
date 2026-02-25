import { Card, Col, Row } from 'react-bootstrap';

interface Stats {
  totalItems: number;
  listedItems: number;
  transitionItems: number;
  delistedItems: number;
  lastSyncAt: string | null;
}

interface DrugMasterStatsCardsProps {
  stats: Stats | null;
}

export default function DrugMasterStatsCards({ stats }: DrugMasterStatsCardsProps) {
  return (
    <Row className="g-3 mb-3">
      <Col md={4} xl>
        <Card className="text-center h-100">
          <Card.Body>
            <Card.Title className="display-6">{stats?.totalItems?.toLocaleString() ?? '-'}</Card.Title>
            <Card.Text className="text-muted small">総品目数</Card.Text>
          </Card.Body>
        </Card>
      </Col>
      <Col md={4} xl>
        <Card className="text-center h-100">
          <Card.Body>
            <Card.Title className="display-6">{stats?.listedItems?.toLocaleString() ?? '-'}</Card.Title>
            <Card.Text className="text-muted small">収載中</Card.Text>
          </Card.Body>
        </Card>
      </Col>
      <Col md={4} xl>
        <Card className="text-center h-100">
          <Card.Body>
            <Card.Title className="display-6">{stats?.transitionItems?.toLocaleString() ?? '-'}</Card.Title>
            <Card.Text className="text-muted small">経過措置中</Card.Text>
          </Card.Body>
        </Card>
      </Col>
      <Col md={4} xl>
        <Card className="text-center h-100">
          <Card.Body>
            <Card.Title className="display-6">{stats?.delistedItems?.toLocaleString() ?? '-'}</Card.Title>
            <Card.Text className="text-muted small">削除済</Card.Text>
          </Card.Body>
        </Card>
      </Col>
      <Col md={4} xl>
        <Card className="text-center h-100">
          <Card.Body>
            <div className="small">
              {stats?.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString('ja-JP') : '未実行'}
            </div>
            <Card.Text className="text-muted small">最終同期</Card.Text>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}
