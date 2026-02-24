import type { Ref, RefObject } from 'react';
import { Card, Form, Alert, Button, Spinner } from 'react-bootstrap';

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
    <Card>
      <Card.Header>薬価基準収載品目リストから同期</Card.Header>
      <Card.Body>
        <Form.Group className="mb-2">
          <Form.Label className="small">改定日</Form.Label>
          <Form.Control
            type="date"
            value={revisionDate}
            onChange={(e) => onRevisionDateChange(e.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label className="small">ファイル（xlsx / csv）</Form.Label>
          <Form.Control type="file" ref={syncFileRef as Ref<HTMLInputElement>} accept=".xlsx,.csv" />
        </Form.Group>
        {syncResult && <Alert variant="success" className="py-1 small">{syncResult}</Alert>}
        {syncError && <Alert variant="danger" className="py-1 small">{syncError}</Alert>}
        <Button size="sm" onClick={onSync} disabled={syncing}>
          {syncing ? <><Spinner size="sm" className="me-1" />同期中...</> : '同期実行'}
        </Button>
        <Form.Text className="d-block mt-1 text-muted">
          厚生労働省の薬価基準収載品目リスト（Excel/CSV）をアップロードしてください。
        </Form.Text>
      </Card.Body>
    </Card>
  );
}
