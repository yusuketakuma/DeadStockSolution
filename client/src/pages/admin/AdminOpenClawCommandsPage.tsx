import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import { api } from '../../api/client';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface OpenClawCommand {
  id: number;
  commandName: string;
  category: string;
  descriptionJa: string | null;
  isEnabled: boolean;
  parametersSchema: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const EMPTY_FORM = {
  commandName: '',
  category: '',
  descriptionJa: '',
  isEnabled: true,
  parametersSchema: '',
};

export default function AdminOpenClawCommandsPage() {
  const [items, setItems] = useState<OpenClawCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<OpenClawCommand | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: OpenClawCommand[] }>('/admin/openclaw-commands');
      setItems(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (item: OpenClawCommand) => {
    setEditingId(item.id);
    setFormData({
      commandName: item.commandName,
      category: item.category,
      descriptionJa: item.descriptionJa ?? '',
      isEnabled: item.isEnabled,
      parametersSchema: item.parametersSchema ?? '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleFormChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFormError('');
  };

  const handleSave = async () => {
    setFormSaving(true);
    setFormError('');
    try {
      const payload = {
        commandName: formData.commandName,
        category: formData.category,
        descriptionJa: formData.descriptionJa || (editingId ? null : undefined),
        isEnabled: formData.isEnabled,
        parametersSchema: formData.parametersSchema || (editingId ? null : undefined),
      };
      if (editingId) {
        await api.put(`/admin/openclaw-commands/${editingId}`, payload);
        setSuccess('コマンドを更新しました');
      } else {
        await api.post('/admin/openclaw-commands', payload);
        setSuccess('コマンドを登録しました');
      }
      setShowModal(false);
      void fetchList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/openclaw-commands/${deleteTarget.id}`);
      setSuccess('コマンドを削除しました');
      setDeleteTarget(null);
      void fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">OpenClawコマンド管理</h4>
        <Button variant="primary" size="sm" onClick={openCreateModal}>新規登録</Button>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

      <ScrollArea>
        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" size="sm" /> 読み込み中...</div>
        ) : items.length === 0 ? (
          <Card body className="text-center text-muted">コマンドデータがありません。「新規登録」から追加してください。</Card>
        ) : (
          <Card>
            <Table responsive hover className="mb-0 mobile-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>コマンド名</th>
                  <th>カテゴリ</th>
                  <th>説明</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td><code>{item.commandName}</code></td>
                    <td><Badge bg="info">{item.category}</Badge></td>
                    <td className="text-muted small">{item.descriptionJa ?? '\u2014'}</td>
                    <td>
                      <Badge bg={item.isEnabled ? 'success' : 'secondary'}>
                        {item.isEnabled ? '有効' : '無効'}
                      </Badge>
                    </td>
                    <td>
                      <Button variant="outline-primary" size="sm" className="me-1" onClick={() => openEditModal(item)}>編集</Button>
                      <Button variant="outline-danger" size="sm" onClick={() => setDeleteTarget(item)}>削除</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </ScrollArea>

      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>{editingId ? 'コマンドの編集' : 'コマンドの新規登録'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError && <Alert variant="danger" className="mb-3">{formError}</Alert>}
          <Row>
            <Col xs={12} className="mb-3">
              <Form.Group>
                <Form.Label>コマンド名</Form.Label>
                <Form.Control type="text" value={formData.commandName} onChange={(e) => handleFormChange('commandName', e.target.value)} placeholder="例: sync_inventory" disabled={formSaving} />
              </Form.Group>
            </Col>
            <Col xs={12} className="mb-3">
              <Form.Group>
                <Form.Label>カテゴリ</Form.Label>
                <Form.Control type="text" value={formData.category} onChange={(e) => handleFormChange('category', e.target.value)} placeholder="例: inventory" disabled={formSaving} />
              </Form.Group>
            </Col>
            <Col xs={12} className="mb-3">
              <Form.Group>
                <Form.Label>説明（任意）</Form.Label>
                <Form.Control type="text" value={formData.descriptionJa} onChange={(e) => handleFormChange('descriptionJa', e.target.value)} disabled={formSaving} />
              </Form.Group>
            </Col>
            <Col xs={12} className="mb-3">
              <Form.Check type="switch" label="有効" checked={formData.isEnabled} onChange={(e) => handleFormChange('isEnabled', e.target.checked)} disabled={formSaving} />
            </Col>
            <Col xs={12}>
              <Form.Group>
                <Form.Label>パラメータスキーマ（任意, JSON）</Form.Label>
                <Form.Control as="textarea" rows={3} value={formData.parametersSchema} onChange={(e) => handleFormChange('parametersSchema', e.target.value)} disabled={formSaving} />
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowModal(false)} disabled={formSaving}>キャンセル</Button>
          <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={formSaving || !formData.commandName || !formData.category}>
            {formSaving ? <><Spinner animation="border" size="sm" /> 保存中...</> : '保存'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={deleteTarget !== null} onHide={() => setDeleteTarget(null)}>
        <Modal.Header closeButton><Modal.Title>削除確認</Modal.Title></Modal.Header>
        <Modal.Body>
          {deleteTarget && <p>コマンド「{deleteTarget.commandName}」を削除しますか？</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>キャンセル</Button>
          <Button variant="danger" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? <><Spinner animation="border" size="sm" /> 削除中...</> : '削除'}
          </Button>
        </Modal.Footer>
      </Modal>
    </PageShell>
  );
}
