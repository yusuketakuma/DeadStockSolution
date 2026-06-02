import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Tab, Tabs } from 'react-bootstrap';
import { api } from '../../api/client';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';

interface BusinessHourItem {
  pharmacyId: number;
  pharmacyName: string | null;
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean | null;
  is24Hours: boolean | null;
}

interface SpecialHourItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  specialType: string;
  startDate: string;
  endDate: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
  note: string | null;
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const SPECIAL_TYPE_LABELS: Record<string, string> = {
  holiday_closed: '祝日休業',
  long_holiday_closed: '長期休業',
  temporary_closed: '臨時休業',
  special_open: '特別営業',
};

const BUSINESS_HOURS_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '薬局運用',
    description: '営業時間の整備対象を確認するときに使います。',
    links: [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/groups', label: 'グループ管理' },
    ],
  },
  {
    title: '周辺設定・監査',
    description: '関連設定や障害切り分けに移るときの導線です。',
    links: [
      { to: '/admin/relationships', label: '関係性監査' },
      { to: '/admin/rate-limits', label: 'レート制限設定' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
] as const;

function formatTime(item: { openTime: string | null; closeTime: string | null; isClosed: boolean | null; is24Hours: boolean | null }): string {
  if (item.isClosed) return '休業';
  if (item.is24Hours) return '24時間';
  if (item.openTime && item.closeTime) return `${item.openTime}〜${item.closeTime}`;
  return '—';
}

export default function AdminBusinessHoursPage() {
  const [regular, setRegular] = useState<BusinessHourItem[]>([]);
  const [special, setSpecial] = useState<SpecialHourItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [regRes, specRes] = await Promise.all([
        api.get<{ data: BusinessHourItem[] }>('/admin/business-hours'),
        api.get<{ data: SpecialHourItem[] }>('/admin/business-hours/special'),
      ]);
      setRegular(regRes.data);
      setSpecial(specRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '営業時間の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  // Group regular hours by pharmacy
  const grouped = new Map<number, { name: string | null; hours: BusinessHourItem[] }>();
  for (const item of regular) {
    if (!grouped.has(item.pharmacyId)) {
      grouped.set(item.pharmacyId, { name: item.pharmacyName, hours: [] });
    }
    grouped.get(item.pharmacyId)!.hours.push(item);
  }

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">営業時間カレンダー</h4>
        </div>
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/pharmacies" className="btn btn-outline-primary btn-sm">薬局管理</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: '薬局ヘルス', to: '/admin/pharmacy-health' },
              { label: 'グループ管理', to: '/admin/groups' },
            ]}
          />
        </div>
      </div>

      {error && <ErrorRetryAlert error={error} onRetry={() => void fetchData()} />}

      <ScrollArea>
        <AdminNavigationLinks groups={BUSINESS_HOURS_LINK_GROUPS} />
        {loading ? (
          <InlineLoader text="営業時間を読み込み中..." className="text-muted small" />
        ) : (
          <Tabs defaultActiveKey="regular" className="mb-3">
            <Tab eventKey="regular" title="通常営業時間">
              {grouped.size === 0 ? (
                <AppEmptyState
                  title="営業時間データがありません"
                  description="薬局情報やグループ設定を確認してから、営業時間登録の有無を見直してください。"
                  action={(
                    <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                      <Link to="/admin/pharmacies" className="btn btn-outline-secondary btn-sm">薬局管理</Link>
                      <AppDropdownMenu
                        label="関連"
                        variant="outline-secondary"
                        items={[
                          { key: 'groups', to: '/admin/groups', label: 'グループ管理' },
                        ]}
                      />
                    </div>
                  )}
                />
              ) : (
                <div className="d-flex flex-column gap-3">
                  {[...grouped.entries()].map(([pharmacyId, { name, hours }]) => (
                    <Card key={pharmacyId}>
                      <Card.Header className="py-2 d-flex justify-content-between align-items-center gap-2 flex-wrap">
                        <span>{name ?? `薬局ID:${pharmacyId}`}</span>
                        <Link to={`/admin/pharmacies/${pharmacyId}/edit`} className="btn btn-outline-primary btn-sm">
                          編集
                        </Link>
                      </Card.Header>
                      <Card.Body className="p-0">
                        <div className="table-responsive">
                          <AppTable size="sm" className="mb-0 mobile-table">
                            <thead className="table-light">
                              <tr>
                                {DAY_NAMES.map((d) => <th key={d} className="text-center">{d}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                {DAY_NAMES.map((_, idx) => {
                                  const h = hours.find((hh) => hh.dayOfWeek === idx);
                                  return (
                                    <td key={idx} className="text-center small">
                                      {h ? formatTime(h) : '—'}
                                    </td>
                                  );
                                })}
                              </tr>
                            </tbody>
                          </AppTable>
                        </div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              )}
            </Tab>
            <Tab eventKey="special" title="特別営業・休業日">
              {special.length === 0 ? (
                <AppEmptyState
                  title="特別営業時間データがありません"
                  description="定休日や臨時休業の確認が必要な場合は、薬局管理と薬局ヘルスも合わせて確認してください。"
                  action={(
                    <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                      <Link to="/admin/pharmacies" className="btn btn-outline-secondary btn-sm">薬局管理</Link>
                      <AppDropdownMenu
                        label="関連"
                        variant="outline-secondary"
                        items={[
                          { key: 'pharmacy-health', to: '/admin/pharmacy-health', label: '薬局ヘルス' },
                        ]}
                      />
                    </div>
                  )}
                />
              ) : (
                <div className="table-responsive">
                  <AppTable striped hover size="sm" className="mobile-table">
                    <thead className="table-light">
                      <tr>
                        <th>薬局</th>
                        <th>タイプ</th>
                        <th>期間</th>
                        <th>時間</th>
                        <th>備考</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {special.map((s) => (
                        <tr key={s.id}>
                          <td>{s.pharmacyName ?? `ID:${s.pharmacyId}`}</td>
                          <td>
                            <Badge bg={s.specialType === 'special_open' ? 'success' : 'secondary'}>
                              {SPECIAL_TYPE_LABELS[s.specialType] ?? s.specialType}
                            </Badge>
                          </td>
                          <td className="small">{s.startDate} 〜 {s.endDate}</td>
                          <td className="small">{formatTime(s)}</td>
                          <td className="small text-muted">{s.note ?? '—'}</td>
                          <td>
                            <Link to={`/admin/pharmacies/${s.pharmacyId}/edit`} className="btn btn-outline-primary btn-sm">
                              編集
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AppTable>
                </div>
              )}
            </Tab>
          </Tabs>
        )}
      </ScrollArea>
    </PageShell>
  );
}
