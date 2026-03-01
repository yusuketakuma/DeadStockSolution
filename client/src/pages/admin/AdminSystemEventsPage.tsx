import { useState, useEffect, useCallback, useRef } from 'react';
import { Row, Col, Badge } from 'react-bootstrap';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import AppSelect from '../../components/ui/AppSelect';
import AppTable from '../../components/ui/AppTable';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import InlineLoader from '../../components/ui/InlineLoader';
import Pagination from '../../components/Pagination';
import { api } from '../../api/client';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface SystemEventEntry {
  id: number;
  source: string;
  level: string;
  eventType: string;
  message: string;
  detailJson: string | null;
  occurredAt: string | null;
  createdAt: string | null;
}

interface SystemEventsResponse {
  data: SystemEventEntry[];
  pagination: { page: number; totalPages: number; total: number };
  summary?: {
    bySource: Record<string, number>;
    byLevel: Record<string, number>;
  };
}

const SOURCE_OPTIONS = [
  { value: '', label: '全てのソース' },
  { value: 'runtime_error', label: 'ランタイムエラー' },
  { value: 'unhandled_rejection', label: 'Unhandled Rejection' },
  { value: 'uncaught_exception', label: 'Uncaught Exception' },
  { value: 'vercel_deploy', label: 'Vercel Deploy' },
];

const LEVEL_OPTIONS = [
  { value: '', label: '全てのレベル' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

function sourceLabel(source: string): string {
  const matched = SOURCE_OPTIONS.find((item) => item.value === source);
  return matched?.label ?? source;
}

function levelBadge(level: string): JSX.Element {
  if (level === 'error') return <Badge bg="danger">Error</Badge>;
  if (level === 'warning') return <Badge bg="warning" text="dark">Warning</Badge>;
  return <Badge bg="secondary">Info</Badge>;
}

function previewDetail(detailJson: string | null): string {
  if (!detailJson) return '-';
  if (detailJson.length <= 180) return detailJson;
  return `${detailJson.slice(0, 180)}...`;
}

export default function AdminSystemEventsPage() {
  const [sourceFilter, setSourceFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const initializedFilterRef = useRef(false);
  const lastAppliedFilterKeyRef = useRef('');
  const filterKey = `${sourceFilter}::${levelFilter}::${keyword.trim()}`;

  const fetchSystemEvents = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage), limit: '50' });
    if (sourceFilter) params.set('source', sourceFilter);
    if (levelFilter) params.set('level', levelFilter);
    if (keyword.trim()) params.set('keyword', keyword.trim());
    return api.get<SystemEventsResponse>(`/admin/system-events?${params}`, { signal });
  }, [sourceFilter, levelFilter, keyword]);

  const {
    items,
    response,
    page,
    setPage,
    totalPages,
    pagination,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<SystemEventEntry, SystemEventsResponse>(fetchSystemEvents, {
    errorMessage: 'システムイベントの取得に失敗しました',
  });

  useEffect(() => {
    if (!initializedFilterRef.current) {
      initializedFilterRef.current = true;
      lastAppliedFilterKeyRef.current = filterKey;
      return;
    }
    if (filterKey === lastAppliedFilterKeyRef.current) {
      return;
    }
    lastAppliedFilterKeyRef.current = filterKey;
    if (page !== 1) {
      setPage(1);
      return;
    }
    void fetchPage(1);
  }, [fetchPage, filterKey, page, setPage]);

  const total = pagination?.total ?? 0;
  const bySource = response?.summary?.bySource ?? {};
  const byLevel = response?.summary?.byLevel ?? {};

  return (
    <div>
      <h4 className="page-title mb-3">システムイベントログ ({total}件)</h4>

      {error && (
        <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>{error}</span>
          <AppButton size="sm" variant="outline-danger" onClick={() => void retry()}>
            再試行
          </AppButton>
        </AppAlert>
      )}

      <Row className="g-2 mb-3">
        <Col md={4}>
          <AppSelect
            value={sourceFilter}
            ariaLabel="ソースで絞り込み"
            onChange={setSourceFilter}
            options={SOURCE_OPTIONS}
          />
        </Col>
        <Col md={3}>
          <AppSelect
            value={levelFilter}
            ariaLabel="レベルで絞り込み"
            onChange={setLevelFilter}
            options={LEVEL_OPTIONS}
          />
        </Col>
        <Col md={5}>
          <AppControl
            placeholder="eventType / message を検索"
            value={keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
          />
        </Col>
      </Row>

      <Row className="g-2 mb-3">
        <Col md={4}>
          <AppCard body className="h-100">
            <div className="small text-muted">Error</div>
            <div className="fs-4 fw-semibold text-danger">{byLevel.error ?? 0}</div>
          </AppCard>
        </Col>
        <Col md={4}>
          <AppCard body className="h-100">
            <div className="small text-muted">Warning</div>
            <div className="fs-4 fw-semibold text-warning">{byLevel.warning ?? 0}</div>
          </AppCard>
        </Col>
        <Col md={4}>
          <AppCard body className="h-100">
            <div className="small text-muted">Vercel Deploy</div>
            <div className="fs-4 fw-semibold">{bySource.vercel_deploy ?? 0}</div>
          </AppCard>
        </Col>
      </Row>

      {loading ? (
        <InlineLoader text="システムイベントを読み込み中..." className="text-muted small mb-3" />
      ) : items.length === 0 ? (
        <AppAlert variant="secondary">システムイベントはまだありません。</AppAlert>
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm" className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>発生日時</th>
                    <th>レベル</th>
                    <th>ソース</th>
                    <th>イベント種別</th>
                    <th>メッセージ</th>
                    <th>詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td className="small">{formatDateTimeJa(item.occurredAt)}</td>
                      <td>{levelBadge(item.level)}</td>
                      <td>{sourceLabel(item.source)}</td>
                      <td><code>{item.eventType}</code></td>
                      <td className="small">{item.message}</td>
                      <td className="small text-muted">{previewDetail(item.detailJson)}</td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {items.map((item) => (
                <AppMobileDataCard
                  key={item.id}
                  title={`イベント #${item.id}`}
                  subtitle={formatDateTimeJa(item.occurredAt)}
                  badges={levelBadge(item.level)}
                  fields={[
                    { label: 'ソース', value: sourceLabel(item.source) },
                    { label: 'イベント種別', value: item.eventType },
                    { label: 'メッセージ', value: item.message },
                    { label: '詳細', value: previewDetail(item.detailJson) },
                  ]}
                />
              ))}
            </div>
          )}
        />
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
