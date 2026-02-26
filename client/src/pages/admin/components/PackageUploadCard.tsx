import type { Ref, RefObject } from 'react';
import { Form, Badge } from 'react-bootstrap';
import InlineLoader from '../../../components/ui/InlineLoader';
import LoadingButton from '../../../components/ui/LoadingButton';
import AppControl from '../../../components/ui/AppControl';
import AppCard from '../../../components/ui/AppCard';

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
    <AppCard>
      <AppCard.Header>包装単位データ登録（GS1/JAN/HOTコード）</AppCard.Header>
      <AppCard.Body>
        <Form.Group className="mb-2">
          <Form.Label className="small">ファイル（xlsx / csv / xml / zip）</Form.Label>
          <AppControl type="file" ref={pkgFileRef as Ref<HTMLInputElement>} accept=".xlsx,.csv,.xml,.zip" />
        </Form.Group>
        <LoadingButton size="sm" onClick={onPackageUpload} loading={pkgUploading} loadingLabel="登録中...">
          登録実行
        </LoadingButton>
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
              <AppControl
                size="sm"
                placeholder="https://... (手動実行時のURL)"
                value={packageManualSourceUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPackageManualSourceUrlChange(e.target.value)}
              />
            </Form.Group>
            <LoadingButton
              size="sm"
              variant="outline-primary"
              onClick={onPackageAutoSyncTrigger}
              disabled={!packageAutoSyncStatus.hasSourceUrl && !packageManualSourceUrl.trim()}
              loading={packageAutoSyncTriggering}
              loadingLabel="確認中..."
            >
              包装単位データを今すぐ取得
            </LoadingButton>
            {!packageAutoSyncStatus.hasSourceUrl && (
              <Form.Text className="d-block mt-1 text-muted">
                環境変数 DRUG_PACKAGE_SOURCE_URL を設定してください。
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
