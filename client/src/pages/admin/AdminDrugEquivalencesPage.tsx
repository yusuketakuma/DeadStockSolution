import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import { api } from '../../api/client';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface DrugEquivalence {
  id: number;
  drugNameA: string;
  drugNameB: string;
  equivalenceType: 'brand_generic' | 'generic_generic';
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const EQUIVALENCE_TYPE_LABELS: Record<string, string> = {
  brand_generic: '先発/後発',
  generic_generic: '後発/後発',
};

const EMPTY_FORM: { drugNameA: string; drugNameB: string; equivalenceType: DrugEquivalence['equivalenceType']; notes: string } = {
  drugNameA: '',
  drugNameB: '',
  equivalenceType: 'brand_generic',
  notes: '',
};

function buildDrugEquivalencePayload(
  formData: typeof EMPTY_FORM,
  editingId: number | null,
): {
  drugNameA: string;
  drugNameB: string;
  equivalenceType: DrugEquivalence['equivalenceType'];
  notes?: string | null;
} {
  return {
    drugNameA: formData.drugNameA,
    drugNameB: formData.drugNameB,
    equivalenceType: formData.equivalenceType,
    notes: editingId ? (formData.notes || null) : (formData.notes || undefined),
  };
}

export default function AdminDrugEquivalencesPage() {
  const [items, setItems] = useState<DrugEquivalence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<DrugEquivalence | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: DrugEquivalence[] }>('/admin/drug-equivalences');
      setItems(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openFormModal = (nextEditingId: number | null, nextFormData: typeof EMPTY_FORM) => {
    setEditingId(nextEditingId);
    setFormData(nextFormData);
    setFormError('');
    setShowModal(true);
  };

  const closeFormModal = () => {
    setShowModal(false);
    setFormError('');
  };

  const openCreateModal = () => {
    openFormModal(null, EMPTY_FORM);
  };

  const openEditModal = (item: DrugEquivalence) => {
    openFormModal(item.id, {
      drugNameA: item.drugNameA,
      drugNameB: item.drugNameB,
      equivalenceType: item.equivalenceType,
      notes: item.notes ?? '',
    });
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFormError('');
  };

  const handleSave = async () => {
    setFormSaving(true);
    setFormError('');
    try {
      const payload = buildDrugEquivalencePayload(formData, editingId);
      if (editingId) {
        await api.put(`/admin/drug-equivalences/${editingId}`, payload);
        setSuccess('薬品同等性を更新しました');
      } else {
        await api.post('/admin/drug-equivalences', payload);
        setSuccess('薬品同等性を登録しました');
      }
      closeFormModal();
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
      await api.delete(`/admin/drug-equivalences/${deleteTarget.id}`);
      setSuccess('薬品同等性を削除しました');
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
        <h4 className="page-title mb-0">薬品同等性マスター</h4>
        <Button variant="primary" size="sm" onClick={openCreateModal}>
          新規登録
        </Button>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

      <ScrollArea>
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" size="sm" /> 読み込み中...
        </div>
      ) : items.length === 0 ? (
        <Card body className="text-center text-muted">
          薬品同等性データがありません。「新規登録」から追加してください。
        </Card>
      ) : (
        <Card>
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>ID</th>
                <th>薬品名A</th>
                <th>薬品名B</th>
                <th>タイプ</th>
                <th>メモ</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.drugNameA}</td>
                  <td>{item.drugNameB}</td>
                  <td>
                    <Badge bg={item.equivalenceType === 'brand_generic' ? 'info' : 'secondary'}>
                      {EQUIVALENCE_TYPE_LABELS[item.equivalenceType] ?? item.equivalenceType}
                    </Badge>
                  </td>
                  <td className="text-muted small">{item.notes ?? '—'}</td>
                  <td>
                    <Button variant="outline-primary" size="sm" className="me-1" onClick={() => openEditModal(item)}>
                      編集
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={() => setDeleteTarget(item)}>
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      </ScrollArea>

      {/* Create/Edit Modal */}
      <Modal show={showModal} onHide={closeFormModal}>
        <Modal.Header closeButton>
          <Modal.Title>{editingId ? '薬品同等性の編集' : '薬品同等性の新規登録'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError && <Alert variant="danger" className="mb-3">{formError}</Alert>}
          <Row>
            <Col xs={12} className="mb-3">
              <Form.Group>
                <Form.Label>薬品名A</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.drugNameA}
                  onChange={(e) => handleFormChange('drugNameA', e.target.value)}
                  placeholder="例: バイアスピリン"
                  disabled={formSaving}
                />
              </Form.Group>
            </Col>
            <Col xs={12} className="mb-3">
              <Form.Group>
                <Form.Label>薬品名B</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.drugNameB}
                  onChange={(e) => handleFormChange('drugNameB', e.target.value)}
                  placeholder="例: アスピリン"
                  disabled={formSaving}
                />
              </Form.Group>
            </Col>
            <Col xs={12} className="mb-3">
              <Form.Group>
                <Form.Label>同等性タイプ</Form.Label>
                <Form.Select
                  value={formData.equivalenceType}
                  onChange={(e) => handleFormChange('equivalenceType', e.target.value)}
                  disabled={formSaving}
                >
                  <option value="brand_generic">先発/後発</option>
                  <option value="generic_generic">後発/後発</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group>
                <Form.Label>メモ（任意）</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => handleFormChange('notes', e.target.value)}
                  disabled={formSaving}
                />
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={closeFormModal} disabled={formSaving}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={formSaving || !formData.drugNameA || !formData.drugNameB}
          >
            {formSaving ? <><Spinner animation="border" size="sm" /> 保存中...</> : '保存'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal show={deleteTarget !== null} onHide={() => setDeleteTarget(null)}>
        <Modal.Header closeButton>
          <Modal.Title>削除確認</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteTarget && (
            <p>
              「{deleteTarget.drugNameA} ↔ {deleteTarget.drugNameB}」の同等性を削除しますか？
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? <><Spinner animation="border" size="sm" /> 削除中...</> : '削除'}
          </Button>
        </Modal.Footer>
      </Modal>
    </PageShell>
  );
}
