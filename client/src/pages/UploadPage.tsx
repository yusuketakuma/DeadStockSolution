import { useState, useRef, FormEvent } from 'react';
import { Card, Form, Button, Alert, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface PreviewResponse {
  headers: string[];
  rows: string[][];
  suggestedMapping: Record<string, string | null>;
  headerRowIndex: number;
  hasSavedMapping: boolean;
}

export default function UploadPage() {
  const [uploadType, setUploadType] = useState<'dead_stock' | 'used_medication'>('dead_stock');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showMatchingHint, setShowMatchingHint] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const fieldLabels: Record<string, string> = {
    drug_code: 'YJコード / GS1コード',
    drug_name: '薬剤名',
    quantity: '数量',
    unit: '包装単位',
    yakka_unit_price: '薬価（単価）',
    expiration_date: '期限',
    lot_number: 'ロット番号',
    monthly_usage: '月間使用量',
  };

  const requiredFields: Record<string, Set<string>> = {
    dead_stock: new Set(['drug_code', 'drug_name', 'quantity', 'unit', 'expiration_date']),
    used_medication: new Set(['drug_code', 'drug_name', 'quantity', 'unit', 'expiration_date', 'monthly_usage']),
  };

  const isRequired = (field: string) => requiredFields[uploadType]?.has(field) ?? false;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    setMessage('');
    setError('');
    setShowMatchingHint(false);
  };

  const handlePreview = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', uploadType);

      const data = await api.upload<PreviewResponse>('/upload/preview', formData);
      setPreview(data);
      setMapping(data.suggestedMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プレビューに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file) return;

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', uploadType);
      formData.append('mapping', JSON.stringify(mapping));
      formData.append('headerRowIndex', String(preview?.headerRowIndex ?? 0));

      const result = await api.upload<{ message: string; rowCount: number }>('/upload/confirm', formData);
      setMessage(`${result.message} マッチング候補の再計算と通知更新が反映されます。`);
      setShowMatchingHint(true);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';

      setTimeout(() => {
        navigate(uploadType === 'dead_stock' ? '/inventory/dead-stock' : '/inventory/used-medication');
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleMappingChange = (field: string, value: string) => {
    setMapping((prev) => ({ ...prev, [field]: value === '' ? null : value }));
  };

  return (
    <div>
      <h4 className="page-title mb-3">Excelアップロード</h4>
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}
      {showMatchingHint && (
        <Alert variant="info">
          交換候補をすぐ確認する場合は「マッチング」ページで再実行してください。
        </Alert>
      )}

      <Card className="mb-3">
        <Card.Header>アップロード手順</Card.Header>
        <Card.Body>
          <ol className="mb-2 upload-step-list">
            <li>アップロードタイプを選択します（デッドストックリスト / 医薬品使用量リスト）。</li>
            <li><code>.xlsx</code> 形式のExcelファイルを選択します（最大10MB）。</li>
            <li>「プレビュー」を押してカラム自動判定を確認します。</li>
            <li>必要に応じてマッピングを修正し、「この設定でデータを登録」を押します。</li>
          </ol>
          <div className="small mt-2">
            <strong>必須項目（<span className="text-danger">赤字</span>）:</strong>
            {uploadType === 'dead_stock' ? (
              <div className="text-danger">YJコード / GS1コード、薬剤名、数量、包装単位、期限</div>
            ) : (
              <div className="text-danger">YJコード / GS1コード、薬剤名、数量、包装単位、期限、調剤回数、調剤数量</div>
            )}
          </div>
          <div className="small text-muted mt-1">
            見出し行が複数ある場合は、プレビュー結果を見て割当を調整してください。
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body>
          <Form onSubmit={handlePreview}>
            <Form.Group className="mb-3">
              <Form.Label>アップロードタイプ</Form.Label>
              <Form.Select
                value={uploadType}
                onChange={(e) => {
                  setUploadType(e.target.value as typeof uploadType);
                  setPreview(null);
                }}
              >
                <option value="dead_stock">デッドストックリスト</option>
                <option value="used_medication">医薬品使用量リスト</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Excelファイル (.xlsx)</Form.Label>
              <Form.Control
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                ref={fileRef}
              />
            </Form.Group>

            <Button type="submit" variant="primary" disabled={!file || loading}>
              {loading ? 'プレビュー中...' : 'プレビュー'}
            </Button>
          </Form>
        </Card.Body>
      </Card>

      {loading && <ProgressBar animated now={100} className="mb-3" />}

      {preview && (
        <Card className="mb-3">
          <Card.Header>
            カラムマッピング
            {preview.hasSavedMapping && <small className="text-muted ms-2">（前回のマッピングを適用）</small>}
          </Card.Header>
          <Card.Body>
            <p className="text-muted small">各カラムに対応するフィールドを選択してください。薬品名は必須です。</p>

            <div className="table-responsive mb-3">
              <table className="table table-sm table-bordered mobile-table">
                <thead>
                  <tr>
                    {preview.headers.map((header, headerIdx) => (
                      <th key={headerIdx} className="small">{header || `列${headerIdx + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 3).map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="small">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h6>フィールド割り当て</h6>
            <div className="d-flex flex-column gap-2">
              {Object.entries(mapping).map(([field, colIdx]) => (
                <div key={field}>
                  <Form.Label className={`small mb-1${isRequired(field) ? ' text-danger fw-semibold' : ''}`}>
                    {fieldLabels[field] || field}
                    {isRequired(field) && <span> *</span>}
                  </Form.Label>
                  <Form.Select
                    size="sm"
                    value={colIdx ?? ''}
                    onChange={(e) => handleMappingChange(field, e.target.value)}
                  >
                    <option value="">（未選択）</option>
                    {preview.headers.map((header, headerIdx) => (
                      <option key={headerIdx} value={String(headerIdx)}>{header || `列${headerIdx + 1}`}</option>
                    ))}
                  </Form.Select>
                </div>
              ))}
            </div>

            <div className="mt-3 mobile-stack">
              <Button
                variant="success"
                onClick={handleConfirm}
                disabled={loading || !mapping.drug_name}
              >
                {loading ? '登録中...' : 'この設定でデータを登録'}
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
