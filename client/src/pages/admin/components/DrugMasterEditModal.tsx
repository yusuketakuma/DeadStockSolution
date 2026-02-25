import { Button, Col, Form, Modal, Row } from 'react-bootstrap';

interface PackageItem {
  id: number;
  gs1Code: string | null;
  janCode: string | null;
  hotCode: string | null;
  packageDescription: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  normalizedPackageLabel?: string | null;
  packageForm?: string | null;
  isLoosePackage?: boolean;
}

interface PriceHistoryItem {
  id: number;
  yjCode: string;
  previousPrice: number | null;
  newPrice: number | null;
  revisionDate: string;
  revisionType: string;
}

interface DrugMasterDetail {
  id: number;
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: number;
  manufacturer: string | null;
  category: string | null;
  isListed: boolean;
  transitionDeadline: string | null;
  updatedAt: string | null;
  therapeuticCategory: string | null;
  listedDate: string | null;
  deletedDate: string | null;
  packages: PackageItem[];
  priceHistory: PriceHistoryItem[];
}

interface DrugMasterEditModalProps {
  editItem: DrugMasterDetail | null;
  show: boolean;
  editSaving: boolean;
  onHide: () => void;
  onEditItemChange: (item: DrugMasterDetail) => void;
  onSave: () => void;
}

export default function DrugMasterEditModal({
  editItem,
  show,
  editSaving,
  onHide,
  onEditItemChange,
  onSave,
}: DrugMasterEditModalProps) {
  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title className="h6">医薬品情報の編集</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {editItem && (
          <Form>
            <Form.Group className="mb-2">
              <Form.Label className="small">YJコード</Form.Label>
              <Form.Control value={editItem.yjCode} disabled className="font-monospace" />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label className="small">品名</Form.Label>
              <Form.Control
                value={editItem.drugName}
                onChange={(e) => onEditItemChange({ ...editItem, drugName: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label className="small">一般名（成分名）</Form.Label>
              <Form.Control
                value={editItem.genericName || ''}
                onChange={(e) => onEditItemChange({ ...editItem, genericName: e.target.value || null })}
              />
            </Form.Group>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small">規格</Form.Label>
                  <Form.Control
                    value={editItem.specification || ''}
                    onChange={(e) => onEditItemChange({ ...editItem, specification: e.target.value || null })}
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small">単位</Form.Label>
                  <Form.Control
                    value={editItem.unit || ''}
                    onChange={(e) => onEditItemChange({ ...editItem, unit: e.target.value || null })}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small">薬価（円）</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    min="0"
                    value={editItem.yakkaPrice}
                    onChange={(e) => onEditItemChange({ ...editItem, yakkaPrice: Number(e.target.value) || 0 })}
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small">メーカー</Form.Label>
                  <Form.Control
                    value={editItem.manufacturer || ''}
                    onChange={(e) => onEditItemChange({ ...editItem, manufacturer: e.target.value || null })}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <Form.Check
                  type="switch"
                  label="薬価基準収載中"
                  checked={editItem.isListed}
                  onChange={(e) => onEditItemChange({ ...editItem, isListed: e.target.checked })}
                  className="mb-2"
                />
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small">経過措置期限</Form.Label>
                  <Form.Control
                    type="date"
                    value={editItem.transitionDeadline || ''}
                    onChange={(e) => onEditItemChange({ ...editItem, transitionDeadline: e.target.value || null })}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide}>キャンセル</Button>
        <Button variant="primary" size="sm" onClick={onSave} disabled={editSaving}>
          {editSaving ? '保存中...' : '保存'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
