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
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const fieldLabels: Record<string, string> = {
    drug_code: '薬品コード',
    drug_name: '薬品名',
    quantity: '数量',
    unit: '単位',
    yakka_unit_price: '薬価（単価）',
    expiration_date: '使用期限',
    lot_number: 'ロット番号',
    monthly_usage: '月間使用量',
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    setMessage('');
    setError('');
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
      setMessage(result.message);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';

      // Navigate to the appropriate list
      setTimeout(() => {
        navigate(uploadType === 'dead_stock' ? '/inventory/dead-stock' : '/inventory/used-medication');
      }, 1500);
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
      <h4 className="mb-3">Excelアップロード</h4>
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card className="mb-3">
        <Card.Body>
          <Form onSubmit={handlePreview}>
            <Form.Group className="mb-3">
              <Form.Label>アップロードタイプ</Form.Label>
              <Form.Select
                value={uploadType}
                onChange={(e) => { setUploadType(e.target.value as typeof uploadType); setPreview(null); }}
              >
                <option value="dead_stock">不動在庫</option>
                <option value="used_medication">使用薬剤</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Excelファイル (.xls, .xlsx, .csv)</Form.Label>
              <Form.Control
                type="file"
                accept=".xls,.xlsx,.csv"
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
              <table className="table table-sm table-bordered">
                <thead>
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="small">{h || `列${i + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 3).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="small">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h6>フィールド割り当て</h6>
            {Object.entries(mapping).map(([field, colIdx]) => (
              <Form.Group key={field} className="mb-2 row align-items-center">
                <Form.Label className="col-sm-3 col-form-label small">
                  {fieldLabels[field] || field}
                  {field === 'drug_name' && <span className="text-danger"> *</span>}
                </Form.Label>
                <div className="col-sm-9">
                  <Form.Select
                    size="sm"
                    value={colIdx ?? ''}
                    onChange={(e) => handleMappingChange(field, e.target.value)}
                  >
                    <option value="">（未選択）</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={String(i)}>{h || `列${i + 1}`}</option>
                    ))}
                  </Form.Select>
                </div>
              </Form.Group>
            ))}

            <Button
              variant="success"
              onClick={handleConfirm}
              disabled={loading || !mapping.drug_name}
              className="mt-3"
            >
              {loading ? '登録中...' : 'この設定でデータを登録'}
            </Button>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
