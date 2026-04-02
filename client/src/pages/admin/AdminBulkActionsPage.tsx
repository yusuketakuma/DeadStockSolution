import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Card, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import AppButton from '../../components/ui/AppButton';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface ParseResult {
  pharmacyIds: number[];
  errors: string[];
}

interface BulkActionResponse {
  totalRequested: number;
  succeeded: number;
  failed: number;
  results: { pharmacyId: number; success: boolean; error?: string }[];
}

export default function AdminBulkActionsPage() {
  const [csvContent, setCsvContent] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [action, setAction] = useState<'verify' | 'reject'>('verify');
  const [reason, setReason] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<BulkActionResponse | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleParse = async () => {
    setError('');
    setParseResult(null);
    setResult(null);
    try {
      const res = await api.post<ParseResult>('/admin/bulk-actions/parse-csv', { csvContent });
      setParseResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV解析に失敗しました');
    }
  };

  const handleExecute = async () => {
    if (!parseResult || parseResult.pharmacyIds.length === 0) return;
    if (action === 'reject' && !reason.trim()) {
      setError('却下理由は必須です');
      return;
    }
    setExecuting(true);
    setError('');
    setSuccess('');
    setResult(null);
    try {
      const endpoint = action === 'verify' ? '/admin/pharmacies/bulk-verify' : '/admin/pharmacies/bulk-reject';
      const payload: { pharmacyIds: number[]; reason?: string } = { pharmacyIds: parseResult.pharmacyIds };
      if (reason.trim()) payload.reason = reason.trim();
      const res = await api.post<BulkActionResponse>(endpoint, payload);
      setResult(res);
      setSuccess(`${res.succeeded}件成功、${res.failed}件失敗`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一括操作に失敗しました');
    } finally {
      setExecuting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') setCsvContent(text);
    };
    reader.readAsText(file);
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">一括操作</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/pharmacies" className="btn btn-outline-secondary btn-sm">薬局管理</Link>
        </div>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

      <ScrollArea>
        <Card className="mb-3">
          <Card.Header>CSVアップロード</Card.Header>
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Label>CSVファイル選択</Form.Label>
              <Form.Control type="file" accept=".csv,.txt" size="sm" onChange={handleFileUpload} />
              <Form.Text className="text-muted">薬局IDを含むCSVファイル（1列目がID）</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>またはCSVデータを直接入力</Form.Label>
              <Form.Control
                as="textarea"
                rows={5}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder="薬局ID&#10;1&#10;2&#10;3"
              />
            </Form.Group>
            <AppButton size="sm" variant="outline-primary" onClick={() => void handleParse()} disabled={!csvContent.trim()}>
              解析
            </AppButton>
          </Card.Body>
        </Card>

        {parseResult && (
          <Card className="mb-3">
            <Card.Header>解析結果</Card.Header>
            <Card.Body>
              <div className="mb-2">
                <Badge bg="primary" className="me-2">対象薬局: {parseResult.pharmacyIds.length}件</Badge>
                {parseResult.errors.length > 0 && (
                  <Badge bg="warning">{parseResult.errors.length}件のエラー</Badge>
                )}
              </div>
              {parseResult.errors.length > 0 && (
                <div className="small text-danger mb-3">
                  {parseResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}

              <Row className="g-2 mb-3">
                <Col xs={12} md={4}>
                  <Form.Select size="sm" value={action} onChange={(e) => setAction(e.target.value as 'verify' | 'reject')}>
                    <option value="verify">一括承認</option>
                    <option value="reject">一括却下</option>
                  </Form.Select>
                </Col>
                {action === 'reject' && (
                  <Col xs={12} md={6}>
                    <Form.Control size="sm" placeholder="却下理由（必須）" value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Col>
                )}
              </Row>

              <AppButton
                size="sm"
                variant={action === 'verify' ? 'success' : 'danger'}
                onClick={() => void handleExecute()}
                disabled={executing || parseResult.pharmacyIds.length === 0}
              >
                {executing ? '実行中...' : `${action === 'verify' ? '承認' : '却下'}実行 (${parseResult.pharmacyIds.length}件)`}
              </AppButton>
            </Card.Body>
          </Card>
        )}

        {result && (
          <Card>
            <Card.Header>実行結果</Card.Header>
            <Card.Body>
              <div className="mb-2">
                <Badge bg="success" className="me-2">成功: {result.succeeded}</Badge>
                <Badge bg="danger">失敗: {result.failed}</Badge>
              </div>
              {result.results.filter((r) => !r.success).length > 0 && (
                <div className="small text-danger">
                  {result.results.filter((r) => !r.success).map((r) => (
                    <div key={r.pharmacyId}>薬局ID:{r.pharmacyId} — {r.error ?? '不明なエラー'}</div>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>
        )}
      </ScrollArea>
    </PageShell>
  );
}
