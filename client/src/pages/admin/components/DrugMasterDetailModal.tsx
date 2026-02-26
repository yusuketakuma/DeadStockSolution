import { Badge, Col, Row } from 'react-bootstrap';
import AppTable from '../../../components/ui/AppTable';
import AppModalShell from '../../../components/ui/AppModalShell';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';
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
    <AppModalShell show={show} onHide={onHide} size="lg" title={<span className="h6 mb-0">医薬品詳細</span>}>
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
                <AppResponsiveSwitch
                  desktop={() => (
                    <AppTable size="sm" bordered>
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
                    </AppTable>
                  )}
                  mobile={() => (
                    <div className="dl-mobile-data-list">
                      {detail.packages.map((pkg) => (
                        <AppMobileDataCard
                          key={pkg.id}
                          title={pkg.packageDescription || '包装情報'}
                          fields={[
                            { label: 'GS1コード', value: <span className="font-monospace small">{pkg.gs1Code || '-'}</span> },
                            { label: 'JANコード', value: <span className="font-monospace small">{pkg.janCode || '-'}</span> },
                            { label: 'HOTコード', value: <span className="font-monospace small">{pkg.hotCode || '-'}</span> },
                            { label: '判別ラベル', value: pkg.normalizedPackageLabel || '-' },
                            { label: '数量', value: `${pkg.packageQuantity ?? '-'} ${pkg.packageUnit || ''}`.trim() },
                          ]}
                        />
                      ))}
                    </div>
                  )}
                />
              </>
            )}

            {detail.priceHistory.length > 0 && (
              <>
                <h6 className="mt-3">薬価改定履歴</h6>
                <AppResponsiveSwitch
                  desktop={() => (
                    <AppTable size="sm" bordered>
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
                    </AppTable>
                  )}
                  mobile={() => (
                    <div className="dl-mobile-data-list">
                      {detail.priceHistory.map((ph) => (
                        <AppMobileDataCard
                          key={ph.id}
                          title={ph.revisionDate}
                          badges={<Badge bg="info">{REVISION_TYPE_LABELS[ph.revisionType] || ph.revisionType}</Badge>}
                          fields={[
                            { label: '改定前', value: ph.previousPrice != null ? ph.previousPrice.toLocaleString() : '-' },
                            { label: '改定後', value: ph.newPrice != null ? ph.newPrice.toLocaleString() : '-' },
                          ]}
                        />
                      ))}
                    </div>
                  )}
                />
              </>
            )}
          </>
        )}
    </AppModalShell>
  );
}
