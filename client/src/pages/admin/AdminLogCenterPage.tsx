import { useState, useEffect, useCallback, useRef } from 'react';
import { Row, Col, Tabs, Tab } from 'react-bootstrap';
import AppAlert from '../../components/ui/AppAlert';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import AppSelect from '../../components/ui/AppSelect';
import AppTable from '../../components/ui/AppTable';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import InlineLoader from '../../components/ui/InlineLoader';
import LazyTab from '../../components/ui/LazyTab';
import LevelBadge from '../../components/ui/LevelBadge';
import Pagination from '../../components/Pagination';
import { api } from '../../api/client';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa, truncatePreview } from '../../utils/formatters';
import ErrorCodesTab from './components/ErrorCodesTab';
import CommandHistoryTab from './components/CommandHistoryTab';
import type {
  NormalizedLogEntry,
  LogCenterResponse,
  LogCenterSummary,
} from '../../types/admin-log-center';

// --- Constants ---

const LOG_SOURCE_TABS = [
  { key: 'activity_logs', title: '操作ログ' },
  { key: 'system_events', title: 'システムイベント' },
  { key: 'drug_master_sync_logs', title: '同期ログ' },
] as const;

type TabKey = 'all' | (typeof LOG_SOURCE_TABS)[number]['key'] | 'error_codes' | 'command_history';

const LEVEL_OPTIONS = [
  { value: '', label: '全てのレベル' },
  { value: 'critical', label: 'Critical' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const SOURCE_LABELS: Record<string, string> = {
  activity_logs: '操作ログ',
  system_events: 'システムイベント',
  drug_master_sync_logs: '同期ログ',
};

// --- Helper components ---

function SourceLabel({ source }: { source: string }) {
  return <>{SOURCE_LABELS[source] ?? source}</>;
}

// --- Summary Cards ---

function SummaryCards({ summary }: { summary: LogCenterSummary | null }) {
  return (
    <Row className="g-2 mb-3">
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">総ログ数</div>
          <div className="fs-4 fw-semibold">{summary?.total ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">エラー</div>
          <div className="fs-4 fw-semibold text-danger">{summary?.errors ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">警告</div>
          <div className="fs-4 fw-semibold text-warning">{summary?.warnings ?? 0}</div>
        </AppCard>
      </Col>
      <Col md={3}>
        <AppCard body className="h-100">
          <div className="small text-muted">本日</div>
          <div className="fs-4 fw-semibold">{summary?.today ?? 0}</div>
        </AppCard>
      </Col>
    </Row>
  );
}

// --- Log Table (shared by all/activity_logs/system_events/drug_master_sync_logs tabs) ---

function LogEntriesView({
  sourceFilter,
}: {
  sourceFilter: string;
}) {
  const [levelFilter, setLevelFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const initializedFilterRef = useRef(false);
  const lastAppliedFilterKeyRef = useRef('');
  const filterKey = `${sourceFilter}::${levelFilter}::${keyword.trim()}`;

  const fetchLogs = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage), limit: '50' });
    if (sourceFilter) params.set('source', sourceFilter);
    if (levelFilter) params.set('level', levelFilter);
    if (keyword.trim()) params.set('search', keyword.trim());
    return api.get<LogCenterResponse>(`/admin/log-center?${params}`, { signal });
  }, [sourceFilter, levelFilter, keyword]);

  const {
    items,
    page,
    setPage,
    totalPages,
    pagination,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<NormalizedLogEntry, LogCenterResponse>(fetchLogs, {
    errorMessage: 'ログデータの取得に失敗しました',
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

  return (
    <>
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}

      <Row className="g-2 mb-3">
        <Col md={4}>
          <AppSelect
            value={levelFilter}
            ariaLabel="レベルで絞り込み"
            onChange={setLevelFilter}
            options={LEVEL_OPTIONS}
          />
        </Col>
        <Col md={8}>
          <AppControl
            placeholder="メッセージ / カテゴリ / エラーコードで検索"
            value={keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
          />
        </Col>
      </Row>

      <div className="small text-muted mb-2">{total}件</div>

      <div className="page-scroll-area">
        {loading ? (
          <InlineLoader text="ログを読み込み中..." className="text-muted small mb-3" />
        ) : items.length === 0 ? (
          <AppAlert variant="secondary">ログデータがありません。</AppAlert>
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover size="sm" className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>日時</th>
                      <th>レベル</th>
                      <th>ソース</th>
                      <th>カテゴリ</th>
                      <th>エラーコード</th>
                      <th>メッセージ</th>
                      <th>詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry) => (
                      <tr key={`${entry.source}-${entry.id}`}>
                        <td>{entry.id}</td>
                        <td className="small">{formatDateTimeJa(entry.timestamp)}</td>
                        <td><LevelBadge level={entry.level} /></td>
                        <td><SourceLabel source={entry.source} /></td>
                        <td className="small">{entry.category}</td>
                        <td className="small">{entry.errorCode ?? '-'}</td>
                        <td className="small">{entry.message}</td>
                        <td className="small text-muted">{truncatePreview(entry.detail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((entry) => (
                  <AppMobileDataCard
                    key={`${entry.source}-${entry.id}`}
                    title={`ログ #${entry.id}`}
                    subtitle={formatDateTimeJa(entry.timestamp)}
                    badges={<LevelBadge level={entry.level} />}
                    fields={[
                      { label: 'ソース', value: SOURCE_LABELS[entry.source] ?? entry.source },
                      { label: 'カテゴリ', value: entry.category },
                      { label: 'エラーコード', value: entry.errorCode ?? '-' },
                      { label: 'メッセージ', value: entry.message },
                      { label: '詳細', value: truncatePreview(entry.detail) },
                    ]}
                  />
                ))}
              </div>
            )}
          />
        )}
      </div>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </>
  );
}

// --- Main Page ---

export default function AdminLogCenterPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [summary, setSummary] = useState<LogCenterSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await api.get<LogCenterSummary>('/admin/log-center/summary', { signal: ac.signal });
        if (!ac.signal.aborted) setSummary(res);
      } catch (err) {
        if (ac.signal.aborted) return;
        setSummaryError(err instanceof Error ? err.message : 'サマリーの取得に失敗しました');
      }
    })();
    return () => ac.abort();
  }, []);

  return (
    <div className="page-viewport">
      <h4 className="page-title mb-3">ログセンター</h4>

      {summaryError && (
        <AppAlert variant="warning" className="mb-3">
          {summaryError}
        </AppAlert>
      )}

      <SummaryCards summary={summary} />

      <Tabs
        activeKey={activeTab}
        onSelect={(k) => setActiveTab((k ?? 'all') as TabKey)}
        className="mb-3"
      >
        <Tab eventKey="all" title="全て">
          <LogEntriesView sourceFilter="" />
        </Tab>
        {LOG_SOURCE_TABS.map(({ key, title }) => (
          <Tab key={key} eventKey={key} title={title}>
            <LazyTab active={activeTab === key}>
              <LogEntriesView sourceFilter={key} />
            </LazyTab>
          </Tab>
        ))}
        <Tab eventKey="error_codes" title="エラーコード">
          <LazyTab active={activeTab === 'error_codes'}>
            <ErrorCodesTab />
          </LazyTab>
        </Tab>
        <Tab eventKey="command_history" title="コマンド履歴">
          <LazyTab active={activeTab === 'command_history'}>
            <CommandHistoryTab />
          </LazyTab>
        </Tab>
      </Tabs>
    </div>
  );
}
