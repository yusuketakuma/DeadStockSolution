import type { Ref, RefObject } from 'react';
import { Card, Form, Button, Spinner, Badge } from 'react-bootstrap';

interface AutoSyncStatus {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
}

interface PackageUploadCardProps {
  pkgFileRef: RefObject<HTMLInputElement | null>;
  pkgUploading: boolean;
  packageAutoSyncStatus: AutoSyncStatus | null;
  packageAutoSyncTriggering: boolean;
  packageManualSourceUrl: string;
  onPackageManualSourceUrlChange: (url: string) => void;
  onPackageUpload: () => void;
  onPackageAutoSyncTrigger: () => void;
}

export default function PackageUploadCard({
  pkgFileRef,
  pkgUploading,
  packageAutoSyncStatus,
  packageAutoSyncTriggering,
  packageManualSourceUrl,
  onPackageManualSourceUrlChange,
  onPackageUpload,
  onPackageAutoSyncTrigger,
}: PackageUploadCardProps) {
  return (
    <Card>
      <Card.Header>包装単位データ登録（GS1/JAN/HOTコード）</Card.Header>
      <Card.Body>
        <Form.Group className="mb-2">
          <Form.Label className="small">ファイル（xlsx / csv / xml / zip）</Form.Label>
          <Form.Control type="file" ref={pkgFileRef as Ref<HTMLInputElement>} accept=".xlsx,.csv,.xml,.zip" />
        </Form.Group>
        <Button size="sm" onClick={onPackageUpload} disabled={pkgUploading}>
          {pkgUploading ? <><Spinner size="sm" className="me-1" />登録中...</> : '登録実行'}
        </Button>
        <Form.Text className="d-block mt-1 text-muted">
          GS1コード・JANコード・HOTコードを含む包装単位データを登録します（PMDA XML / ZIPにも対応）。
        </Form.Text>
        <hr className="my-3" />
        <div className="small fw-semibold mb-2">外部データ自動取得</div>
        {packageAutoSyncStatus ? (
          <>
            <div className="small mb-1">
              状態:
              {' '}
              <Badge bg={packageAutoSyncStatus.enabled ? 'success' : 'secondary'}>
                {packageAutoSyncStatus.enabled ? '有効' : '無効'}
              </Badge>
              {packageAutoSyncStatus.enabled && (
                <span className="ms-2 text-muted">{packageAutoSyncStatus.checkIntervalHours}時間ごと</span>
              )}
            </div>
            <div className="small mb-2">
              取得元:
              {' '}
              {packageAutoSyncStatus.hasSourceUrl ? (
                <span className="font-monospace">{packageAutoSyncStatus.sourceHost}</span>
              ) : (
                <span className="text-muted">未設定</span>
              )}
            </div>
            <Form.Group className="mb-2">
              <Form.Control
                size="sm"
                placeholder="https://... (手動実行時のURL)"
                value={packageManualSourceUrl}
                onChange={(e) => onPackageManualSourceUrlChange(e.target.value)}
              />
            </Form.Group>
            <Button
              size="sm"
              variant="outline-primary"
              onClick={onPackageAutoSyncTrigger}
              disabled={packageAutoSyncTriggering || (!packageAutoSyncStatus.hasSourceUrl && !packageManualSourceUrl.trim())}
            >
              {packageAutoSyncTriggering ? <><Spinner size="sm" className="me-1" />確認中...</> : '包装単位データを今すぐ取得'}
            </Button>
            {!packageAutoSyncStatus.hasSourceUrl && (
              <Form.Text className="d-block mt-1 text-muted">
                環境変数 DRUG_PACKAGE_SOURCE_URL を設定してください。
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
