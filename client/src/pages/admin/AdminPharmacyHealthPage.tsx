import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Col, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { formatDateTimeJa } from '../../utils/formatters';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';

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

const PHARMACY_HEALTH_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '薬局運用',
    description: '対象薬局の状態と周辺設定を見直すときに使います。',
    links: [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/relationships', label: '関係性監査' },
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/groups', label: 'グループ管理' },
    ],
  },
  {
    title: '周辺運用',
    description: 'ヘルス低下時の一括対応や障害切り分けへ移れます。',
    links: [
      { to: '/admin/bulk-actions', label: '一括操作' },
      { to: '/admin/notifications', label: '通知・配信状況' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
] as const;

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
          <Link to="/admin/relationships" className="btn btn-outline-secondary btn-sm">関係性監査</Link>
        </div>
      </div>

      {error && <ErrorRetryAlert error={error} onRetry={() => void fetchData()} />}

      <ScrollArea>
        <AdminNavigationLinks groups={PHARMACY_HEALTH_LINK_GROUPS} />
        {loading ? (
          <InlineLoader text="ヘルス情報を読み込み中..." className="text-muted small" />
        ) : data && (data.activityByPharmacy.length > 0 || data.trustScores.length > 0) ? (
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
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.activityByPharmacy.map((a) => (
                          <tr key={a.pharmacyId ?? 'null'}>
                            <td>{a.pharmacyName ?? `ID:${a.pharmacyId ?? '—'}`}</td>
                            <td><Badge bg="primary">{a.actionCount}</Badge></td>
                            <td className="small">{formatDateTimeJa(a.lastActivity)}</td>
                            <td>
                              {a.pharmacyId ? (
                                <Link to={`/admin/pharmacies/${a.pharmacyId}/edit`} className="btn btn-outline-primary btn-sm">
                                  編集
                                </Link>
                              ) : (
                                <span className="text-muted small">—</span>
                              )}
                            </td>
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
                          <th>操作</th>
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
                            <td>
                              <Link to={`/admin/pharmacies/${t.pharmacyId}/edit`} className="btn btn-outline-primary btn-sm">
                                編集
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </AppTable>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        ) : (
          <AppEmptyState
            title="薬局ヘルス情報がありません"
            description="薬局管理や関係性監査、営業時間の整備を進めると、ここでアクティビティや信頼スコアを追えるようになります。"
            action={(
              <div className="mt-3 d-flex gap-2 flex-wrap justify-content-center">
                <Link to="/admin/pharmacies" className="btn btn-outline-secondary btn-sm">薬局管理</Link>
                <Link to="/admin/relationships" className="btn btn-outline-secondary btn-sm">関係性監査</Link>
                <Link to="/admin/business-hours" className="btn btn-outline-secondary btn-sm">営業時間</Link>
              </div>
            )}
          />
        )}
      </ScrollArea>
    </PageShell>
  );
}
