import { Row, Col, Badge, Form } from 'react-bootstrap';
import AppCard from '../../../components/ui/AppCard';
import InlineLoader from '../../../components/ui/InlineLoader';
import LoadingButton from '../../../components/ui/LoadingButton';
import AppControl from '../../../components/ui/AppControl';

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
    <AppCard className="mb-3">
      <AppCard.Header>厚生労働省サイトからの自動取得</AppCard.Header>
      <AppCard.Body>
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
                <AppControl
                  size="sm"
                  placeholder="https://..."
                  value={manualSourceUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onManualSourceUrlChange(e.target.value)}
                />
                <Form.Text className="text-muted">
                  DRUG_MASTER_SOURCE_URL未設定時でも、HTTPS URLを指定して手動実行できます。
                </Form.Text>
              </Col>
            </Row>
            <hr className="my-2" />
            <LoadingButton
              size="sm"
              variant="outline-primary"
              onClick={onAutoSyncTrigger}
              disabled={!autoSyncStatus.hasSourceUrl && !manualSourceUrl.trim()}
              loading={autoSyncTriggering}
              loadingLabel="確認中..."
            >
              今すぐ更新を確認・取得
            </LoadingButton>
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
          <InlineLoader text="読み込み中..." />
        )}
      </AppCard.Body>
    </AppCard>
  );
}
