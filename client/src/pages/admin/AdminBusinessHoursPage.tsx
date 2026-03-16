import { useEffect, useState } from 'react';
import { Badge, Card, Tab, Tabs } from 'react-bootstrap';
import { api } from '../../api/client';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

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
      <h4 className="page-title mb-3">営業時間カレンダー</h4>

      {error && <ErrorRetryAlert error={error} onRetry={() => void fetchData()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="営業時間を読み込み中..." className="text-muted small" />
        ) : (
          <Tabs defaultActiveKey="regular" className="mb-3">
            <Tab eventKey="regular" title="通常営業時間">
              {grouped.size === 0 ? (
                <AppEmptyState title="営業時間データがありません" />
              ) : (
                <div className="d-flex flex-column gap-3">
                  {[...grouped.entries()].map(([pharmacyId, { name, hours }]) => (
                    <Card key={pharmacyId}>
                      <Card.Header className="py-2">
                        {name ?? `薬局ID:${pharmacyId}`}
                      </Card.Header>
                      <Card.Body className="p-0">
                        <AppTable size="sm" className="mb-0">
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
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              )}
            </Tab>
            <Tab eventKey="special" title="特別営業・休業日">
              {special.length === 0 ? (
                <AppEmptyState title="特別営業時間データがありません" />
              ) : (
                <AppTable striped hover size="sm">
                  <thead className="table-light">
                    <tr>
                      <th>薬局</th>
                      <th>タイプ</th>
                      <th>期間</th>
                      <th>時間</th>
                      <th>備考</th>
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
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              )}
            </Tab>
          </Tabs>
        )}
      </ScrollArea>
    </PageShell>
  );
}
