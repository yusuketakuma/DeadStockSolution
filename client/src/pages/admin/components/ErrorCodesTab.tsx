import { useState, useCallback } from 'react';
import { Row, Col, Badge } from 'react-bootstrap';
import AppAlert from '../../../components/ui/AppAlert';
import AppButton from '../../../components/ui/AppButton';
import AppCard from '../../../components/ui/AppCard';
import AppControl from '../../../components/ui/AppControl';
import AppSelect from '../../../components/ui/AppSelect';
import AppTable from '../../../components/ui/AppTable';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import InlineLoader from '../../../components/ui/InlineLoader';
import LevelBadge from '../../../components/ui/LevelBadge';
import { api } from '../../../api/client';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import type { ErrorCode, ErrorCodesResponse } from '../../../types/admin-log-center';

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const EMPTY_ERROR_CODE_FORM = {
  code: '',
  category: '',
  severity: 'error',
  titleJa: '',
  descriptionJa: '',
  resolutionJa: '',
};

export default function ErrorCodesTab() {
  const { data: errorCodes, loading, error, reload } = useAsyncResource(
    useCallback((signal: AbortSignal) =>
      api.get<ErrorCodesResponse>('/admin/error-codes', { signal }).then((r) => r.items),
    []),
  );
  const [form, setForm] = useState(EMPTY_ERROR_CODE_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.titleJa.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editingId !== null) {
        await api.put(`/admin/error-codes/${editingId}`, {
          ...form,
          descriptionJa: form.descriptionJa || null,
          resolutionJa: form.resolutionJa || null,
        });
      } else {
        await api.post('/admin/error-codes', {
          ...form,
          descriptionJa: form.descriptionJa || null,
          resolutionJa: form.resolutionJa || null,
        });
      }
      setForm(EMPTY_ERROR_CODE_FORM);
      setEditingId(null);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (ec: ErrorCode) => {
    setEditingId(ec.id);
    setForm({
      code: ec.code,
      category: ec.category,
      severity: ec.severity,
      titleJa: ec.titleJa,
      descriptionJa: ec.descriptionJa ?? '',
      resolutionJa: ec.resolutionJa ?? '',
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(EMPTY_ERROR_CODE_FORM);
  };

  return (
    <>
      {(error || saveError) && (
        <AppAlert variant="danger" className="mb-3">
          {error || saveError}
        </AppAlert>
      )}

      <AppCard className="mb-3">
        <AppCard.Body>
          <AppCard.Title className="h6 mb-3">
            {editingId !== null ? 'エラーコード編集' : 'エラーコード追加'}
          </AppCard.Title>
          <Row className="g-2 mb-2">
            <Col md={2}>
              <AppControl
                placeholder="コード (例: E001)"
                value={form.code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, code: e.target.value }))
                }
              />
            </Col>
            <Col md={2}>
              <AppControl
                placeholder="カテゴリ"
                value={form.category}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, category: e.target.value }))
                }
              />
            </Col>
            <Col md={2}>
              <AppSelect
                value={form.severity}
                ariaLabel="重大度"
                onChange={(value) => setForm((prev) => ({ ...prev, severity: value }))}
                options={SEVERITY_OPTIONS}
              />
            </Col>
            <Col md={3}>
              <AppControl
                placeholder="タイトル（日本語）"
                value={form.titleJa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, titleJa: e.target.value }))
                }
              />
            </Col>
            <Col md={3}>
              <AppControl
                placeholder="説明（日本語）"
                value={form.descriptionJa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, descriptionJa: e.target.value }))
                }
              />
            </Col>
          </Row>
          <Row className="g-2">
            <Col md={6}>
              <AppControl
                placeholder="対処法（日本語）"
                value={form.resolutionJa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, resolutionJa: e.target.value }))
                }
              />
            </Col>
            <Col md={6} className="d-flex gap-2 align-items-start">
              <AppButton
                size="sm"
                variant="primary"
                onClick={() => void handleSubmit()}
                disabled={saving || !form.code.trim() || !form.titleJa.trim()}
              >
                {saving ? '保存中...' : editingId !== null ? '更新' : '追加'}
              </AppButton>
              {editingId !== null && (
                <AppButton size="sm" variant="outline-secondary" onClick={handleCancel}>
                  キャンセル
                </AppButton>
              )}
            </Col>
          </Row>
        </AppCard.Body>
      </AppCard>

      {loading ? (
        <InlineLoader text="エラーコードを読み込み中..." className="text-muted small mb-3" />
      ) : !errorCodes?.length ? (
        <AppAlert variant="secondary">エラーコードが登録されていません。</AppAlert>
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm" className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>コード</th>
                    <th>カテゴリ</th>
                    <th>重大度</th>
                    <th>タイトル</th>
                    <th>説明</th>
                    <th>対処法</th>
                    <th>状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {errorCodes?.map((ec) => (
                    <tr key={ec.id}>
                      <td>{ec.id}</td>
                      <td><code>{ec.code}</code></td>
                      <td className="small">{ec.category}</td>
                      <td><LevelBadge level={ec.severity} /></td>
                      <td className="small">{ec.titleJa}</td>
                      <td className="small text-muted">{ec.descriptionJa ?? '-'}</td>
                      <td className="small text-muted">{ec.resolutionJa ?? '-'}</td>
                      <td>
                        <Badge bg={ec.isActive ? 'success' : 'secondary'}>
                          {ec.isActive ? '有効' : '無効'}
                        </Badge>
                      </td>
                      <td>
                        <AppButton size="sm" variant="outline-primary" onClick={() => handleEdit(ec)}>
                          編集
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {errorCodes?.map((ec) => (
                <AppMobileDataCard
                  key={ec.id}
                  title={`${ec.code}: ${ec.titleJa}`}
                  subtitle={ec.category}
                  badges={
                    <>
                      <LevelBadge level={ec.severity} />
                      <Badge bg={ec.isActive ? 'success' : 'secondary'}>
                        {ec.isActive ? '有効' : '無効'}
                      </Badge>
                    </>
                  }
                  fields={[
                    { label: '説明', value: ec.descriptionJa ?? '-' },
                    { label: '対処法', value: ec.resolutionJa ?? '-' },
                  ]}
                  actions={
                    <AppButton size="sm" variant="outline-primary" onClick={() => handleEdit(ec)}>
                      編集
                    </AppButton>
                  }
                />
              ))}
            </div>
          )}
        />
      )}
    </>
  );
}
