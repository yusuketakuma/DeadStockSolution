import type { Ref, RefObject } from 'react';
import { Form } from 'react-bootstrap';
import AppAlert from '../../../components/ui/AppAlert';
import LoadingButton from '../../../components/ui/LoadingButton';
import AppControl from '../../../components/ui/AppControl';
import AppCard from '../../../components/ui/AppCard';

interface PackageUploadCardProps {
  pkgFileRef: RefObject<HTMLInputElement | null>;
  pkgUploading: boolean;
  packageMessage: string;
  packageError: string;
  onPackageUpload: () => void;
}

export default function PackageUploadCard({
  pkgFileRef,
  pkgUploading,
  packageMessage,
  packageError,
  onPackageUpload,
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
        {packageMessage && <AppAlert variant="success" className="py-1 small mt-2">{packageMessage}</AppAlert>}
        {packageError && <AppAlert variant="danger" className="py-1 small mt-2">{packageError}</AppAlert>}
      </AppCard.Body>
    </AppCard>
  );
}
