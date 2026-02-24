import { Card, Row, Col, Badge, Form, Button, Spinner } from 'react-bootstrap';

interface AutoSyncStatus {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
}

interface AutoSyncStatusCardProps {
  autoSyncStatus: AutoSyncStatus | null;
  autoSyncTriggering: boolean;
  manualSourceUrl: string;
  onManualSourceUrlChange: (url: string) => void;
  onAutoSyncTrigger: () => void;
}

export default function AutoSyncStatusCard({
  autoSyncStatus,
  autoSyncTriggering,
  manualSourceUrl,
  onManualSourceUrlChange,
  onAutoSyncTrigger,
}: AutoSyncStatusCardProps) {
  return (
    <Card className="mb-3">
      <Card.Header>厚生労働省サイトからの自動取得</Card.Header>
      <Card.Body>
        {autoSyncStatus ? (
          <>
            <Row className="mb-2">
              <Col sm={3} className="text-muted small">自動検知</Col>
              <Col sm={9}>
                <Badge bg={autoSyncStatus.enabled ? 'success' : 'secondary'}>
                  {autoSyncStatus.enabled ? '有効' : '無効'}
                </Badge>
                {autoSyncStatus.enabled && (
                  <span className="ms-2 small text-muted">
                    {autoSyncStatus.checkIntervalHours}時間ごとにチェック
                  </span>
                )}
              </Col>
            </Row>
            <Row className="mb-2">
              <Col sm={3} className="text-muted small">取得元URL</Col>
              <Col sm={9}>
                {autoSyncStatus.hasSourceUrl ? (
                  <span className="small font-monospace">{autoSyncStatus.sourceHost}</span>
                ) : (
                  <span className="small text-muted">未設定</span>
                )}
              </Col>
            </Row>
            <Row className="mb-2">
              <Col sm={3} className="text-muted small">手動URL指定</Col>
              <Col sm={9}>
                <Form.Control
                  size="sm"
                  placeholder="https://..."
                  value={manualSourceUrl}
                  onChange={(e) => onManualSourceUrlChange(e.target.value)}
                />
                <Form.Text className="text-muted">
                  DRUG_MASTER_SOURCE_URL未設定時でも、HTTPS URLを指定して手動実行できます。
                </Form.Text>
              </Col>
            </Row>
            <hr className="my-2" />
            <Button
              size="sm"
              variant="outline-primary"
              onClick={onAutoSyncTrigger}
              disabled={autoSyncTriggering || (!autoSyncStatus.hasSourceUrl && !manualSourceUrl.trim())}
            >
              {autoSyncTriggering ? <><Spinner size="sm" className="me-1" />確認中...</> : '今すぐ更新を確認・取得'}
            </Button>
            {!autoSyncStatus.hasSourceUrl && (
              <Form.Text className="d-block mt-1 text-muted">
                環境変数 DRUG_MASTER_SOURCE_URL を設定してください。
              </Form.Text>
            )}
            {!autoSyncStatus.enabled && autoSyncStatus.hasSourceUrl && (
              <Form.Text className="d-block mt-1 text-muted">
                環境変数 DRUG_MASTER_AUTO_SYNC=true で定期チェックを有効にできます。
              </Form.Text>
            )}
          </>
        ) : (
          <Spinner size="sm" />
        )}
      </Card.Body>
    </Card>
  );
}
