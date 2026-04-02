import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Col, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { formatDateTimeJa } from '../../utils/formatters';

interface ActivitySummary {
  pharmacyId: number | null;
  pharmacyName: string | null;
  actionCount: number;
  lastActivity: string | null;
}

interface TrustScoreSummary {
  pharmacyId: number;
  pharmacyName: string | null;
  trustScore: string;
  ratingCount: number;
  positiveRate: string;
  updatedAt: string | null;
}

interface HealthData {
  activityByPharmacy: ActivitySummary[];
  trustScores: TrustScoreSummary[];
}

export default function AdminPharmacyHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: HealthData }>('/admin/pharmacy-health');
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '薬局ヘルス情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">薬局ヘルス</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/pharmacies" className="btn btn-outline-secondary btn-sm">薬局管理</Link>
        </div>
      </div>

      {error && <ErrorRetryAlert error={error} onRetry={() => void fetchData()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="ヘルス情報を読み込み中..." className="text-muted small" />
        ) : data && (
          <Row className="g-3">
            <Col xs={12} lg={6}>
              <Card>
                <Card.Header>アクティビティランキング（上位50）</Card.Header>
                <Card.Body className="p-0">
                  <div className="table-responsive">
                    <AppTable striped size="sm" className="mb-0 mobile-table">
                      <thead className="table-light">
                        <tr>
                          <th>薬局</th>
                          <th>操作回数</th>
                          <th>最終アクティビティ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.activityByPharmacy.map((a) => (
                          <tr key={a.pharmacyId ?? 'null'}>
                            <td>{a.pharmacyName ?? `ID:${a.pharmacyId ?? '—'}`}</td>
                            <td><Badge bg="primary">{a.actionCount}</Badge></td>
                            <td className="small">{formatDateTimeJa(a.lastActivity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </AppTable>
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card>
                <Card.Header>信頼スコア一覧</Card.Header>
                <Card.Body className="p-0">
                  <div className="table-responsive">
                    <AppTable striped size="sm" className="mb-0 mobile-table">
                      <thead className="table-light">
                        <tr>
                          <th>薬局</th>
                          <th>スコア</th>
                          <th>評価数</th>
                          <th>好感率</th>
                          <th>更新日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.trustScores.map((t) => (
                          <tr key={t.pharmacyId}>
                            <td>{t.pharmacyName ?? `ID:${t.pharmacyId}`}</td>
                            <td>
                              <Badge bg={Number(t.trustScore) >= 70 ? 'success' : Number(t.trustScore) >= 40 ? 'warning' : 'danger'}>
                                {Number(t.trustScore).toFixed(1)}
                              </Badge>
                            </td>
                            <td>{t.ratingCount}</td>
                            <td>{Number(t.positiveRate).toFixed(1)}%</td>
                            <td className="small">{formatDateTimeJa(t.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </AppTable>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        )}
      </ScrollArea>
    </PageShell>
  );
}
