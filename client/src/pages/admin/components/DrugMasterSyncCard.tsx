import type { Ref, RefObject } from 'react';
import AppAlert from '../../../components/ui/AppAlert';
import { Form } from 'react-bootstrap';
import AppCard from '../../../components/ui/AppCard';
import LoadingButton from '../../../components/ui/LoadingButton';
import AppControl from '../../../components/ui/AppControl';

interface DrugMasterSyncCardProps {
  revisionDate: string;
  onRevisionDateChange: (date: string) => void;
  syncFileRef: RefObject<HTMLInputElement | null>;
  syncing: boolean;
  syncResult: string;
  syncError: string;
  onSync: () => void;
}

export default function DrugMasterSyncCard({
  revisionDate,
  onRevisionDateChange,
  syncFileRef,
  syncing,
  syncResult,
  syncError,
  onSync,
}: DrugMasterSyncCardProps) {
  return (
    <AppCard>
      <AppCard.Header>薬価基準収載品目リストから同期</AppCard.Header>
      <AppCard.Body>
        <Form.Group className="mb-2">
          <Form.Label className="small">改定日</Form.Label>
          <AppControl
            type="date"
            value={revisionDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onRevisionDateChange(e.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label className="small">ファイル（xlsx / csv）</Form.Label>
          <AppControl type="file" ref={syncFileRef as Ref<HTMLInputElement>} accept=".xlsx,.csv" />
        </Form.Group>
        {syncResult && <AppAlert variant="success" className="py-1 small">{syncResult}</AppAlert>}
        {syncError && <AppAlert variant="danger" className="py-1 small">{syncError}</AppAlert>}
        <LoadingButton size="sm" onClick={onSync} loading={syncing} loadingLabel="同期中...">
          同期実行
        </LoadingButton>
        <Form.Text className="d-block mt-1 text-muted">
          厚生労働省の薬価基準収載品目リスト（Excel/CSV）をアップロードしてください。
        </Form.Text>
      </AppCard.Body>
    </AppCard>
  );
}
