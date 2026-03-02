import { Row, Col, Badge, Form, Table } from 'react-bootstrap';
import AppCard from '../../../components/ui/AppCard';
import InlineLoader from '../../../components/ui/InlineLoader';
import LoadingButton from '../../../components/ui/LoadingButton';
import AppControl from '../../../components/ui/AppControl';
import { formatDateTimeJa, truncatePreview } from '../../../utils/formatters';

interface DiscoveredFile {
  category: string;
  url: string;
  lastChanged: string | null;
}

interface AutoSyncStatus {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
  sourceMode?: 'index' | 'single';
  discoveredFiles?: DiscoveredFile[];
  lastIndexCheck?: string;
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
  const isIndexMode = autoSyncStatus?.sourceMode === 'index';

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
              <Col sm={3} className="text-muted small">取得モード</Col>
              <Col sm={9}>
                <Badge bg={isIndexMode ? 'info' : 'secondary'} className="me-1">
                  {isIndexMode ? 'インデックスモード' : '単一ファイルモード'}
                </Badge>
                <span className="small text-muted">
                  {isIndexMode
                    ? 'MHLW ポータルから4カテゴリを自動探索'
                    : '指定URLから単一ファイルを取得'}
                </span>
              </Col>
            </Row>
            {!isIndexMode && (
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
            )}
            {isIndexMode && autoSyncStatus.discoveredFiles && autoSyncStatus.discoveredFiles.length > 0 && (
              <Row className="mb-2">
                <Col sm={3} className="text-muted small">発見ファイル</Col>
                <Col sm={9}>
                  <Table size="sm" borderless className="mb-0 small">
                    <thead>
                      <tr>
                        <th className="py-0 px-1">カテゴリ</th>
                        <th className="py-0 px-1">URL</th>
                        <th className="py-0 px-1">最終変更</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoSyncStatus.discoveredFiles.map((f) => (
                        <tr key={f.category}>
                          <td className="py-0 px-1">{f.category}</td>
                          <td className="py-0 px-1 font-monospace text-break" style={{ fontSize: '0.75rem' }} title={f.url}>
                            {truncatePreview(f.url, 60)}
                          </td>
                          <td className="py-0 px-1 text-nowrap">{formatDateTimeJa(f.lastChanged)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {autoSyncStatus.lastIndexCheck && (
                    <Form.Text className="text-muted">
                      最終チェック: {formatDateTimeJa(autoSyncStatus.lastIndexCheck)}
                    </Form.Text>
                  )}
                </Col>
              </Row>
            )}
            {!isIndexMode && (
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
            )}
            <hr className="my-2" />
            <LoadingButton
              size="sm"
              variant="outline-primary"
              onClick={onAutoSyncTrigger}
              disabled={!isIndexMode && !autoSyncStatus.hasSourceUrl && !manualSourceUrl.trim()}
              loading={autoSyncTriggering}
              loadingLabel="確認中..."
            >
              {isIndexMode ? 'MHLW ポータルから探索・取得' : '今すぐ更新を確認・取得'}
            </LoadingButton>
            {!isIndexMode && !autoSyncStatus.hasSourceUrl && (
              <Form.Text className="d-block mt-1 text-muted">
                環境変数 DRUG_MASTER_SOURCE_URL を設定してください。
              </Form.Text>
            )}
            {!autoSyncStatus.enabled && (autoSyncStatus.hasSourceUrl || isIndexMode) && (
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
