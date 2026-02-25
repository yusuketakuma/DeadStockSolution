import { Badge, Col, Modal, Row, Table } from 'react-bootstrap';
import type { DrugMasterDetail } from './types';

const REVISION_TYPE_LABELS: Record<string, string> = {
  price_revision: '薬価改定',
  new_listing: '新規収載',
  delisting: '薬価削除',
  transition: '経過措置',
};

interface DrugMasterDetailModalProps {
  detail: DrugMasterDetail | null;
  show: boolean;
  onHide: () => void;
}

export default function DrugMasterDetailModal({ detail, show, onHide }: DrugMasterDetailModalProps) {
  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h6">医薬品詳細</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {detail && (
          <>
            <Row className="mb-3">
              <Col sm={4}><strong>YJコード</strong><div className="font-monospace">{detail.yjCode}</div></Col>
              <Col sm={4}><strong>薬価</strong><div>{detail.yakkaPrice.toLocaleString()}円</div></Col>
              <Col sm={4}><strong>状態</strong><div>
                {detail.isListed
                  ? (detail.transitionDeadline ? `経過措置（${detail.transitionDeadline}まで）` : '収載中')
                  : `削除済（${detail.deletedDate || '-'}）`}
              </div></Col>
            </Row>
            <Row className="mb-3">
              <Col sm={6}><strong>品名</strong><div>{detail.drugName}</div></Col>
              <Col sm={6}><strong>一般名</strong><div>{detail.genericName || '-'}</div></Col>
            </Row>
            <Row className="mb-3">
              <Col sm={4}><strong>規格</strong><div>{detail.specification || '-'}</div></Col>
              <Col sm={4}><strong>単位</strong><div>{detail.unit || '-'}</div></Col>
              <Col sm={4}><strong>区分</strong><div>{detail.category || '-'}</div></Col>
            </Row>
            <Row className="mb-3">
              <Col sm={6}><strong>メーカー</strong><div>{detail.manufacturer || '-'}</div></Col>
              <Col sm={6}><strong>薬効分類番号</strong><div>{detail.therapeuticCategory || '-'}</div></Col>
            </Row>

            {detail.packages.length > 0 && (
              <>
                <h6 className="mt-3">包装単位</h6>
                <Table size="sm" bordered>
                  <thead>
                    <tr>
                      <th>GS1コード</th>
                      <th>JANコード</th>
                      <th>HOTコード</th>
                      <th>包装</th>
                      <th>判別ラベル</th>
                      <th>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.packages.map((pkg) => (
                      <tr key={pkg.id}>
                        <td className="font-monospace small">{pkg.gs1Code || '-'}</td>
                        <td className="font-monospace small">{pkg.janCode || '-'}</td>
                        <td className="font-monospace small">{pkg.hotCode || '-'}</td>
                        <td className="small">{pkg.packageDescription || '-'}</td>
                        <td className="small">{pkg.normalizedPackageLabel || '-'}</td>
                        <td className="small">{pkg.packageQuantity ?? '-'} {pkg.packageUnit || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}

            {detail.priceHistory.length > 0 && (
              <>
                <h6 className="mt-3">薬価改定履歴</h6>
                <Table size="sm" bordered>
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>種別</th>
                      <th className="text-end">改定前</th>
                      <th className="text-end">改定後</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.priceHistory.map((ph) => (
                      <tr key={ph.id}>
                        <td className="small">{ph.revisionDate}</td>
                        <td><Badge bg="info">{REVISION_TYPE_LABELS[ph.revisionType] || ph.revisionType}</Badge></td>
                        <td className="text-end">{ph.previousPrice != null ? ph.previousPrice.toLocaleString() : '-'}</td>
                        <td className="text-end">{ph.newPrice != null ? ph.newPrice.toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
