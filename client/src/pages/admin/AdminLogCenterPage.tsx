import { useState, useEffect, useCallback, useRef } from 'react';
import { Row, Col, Badge, Tabs, Tab } from 'react-bootstrap';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
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
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { formatDateTimeJa, truncatePreview } from '../../utils/formatters';
import type {
  NormalizedLogEntry,
  LogCenterResponse,
  LogCenterSummary,
  ErrorCode,
  ErrorCodesResponse,
  CommandsResponse,
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

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const COMMAND_STATUS_BADGE: Record<string, string> = {
  completed: 'success',
  failed: 'danger',
  pending: 'warning',
  running: 'primary',
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

// --- Error Codes Tab ---

const EMPTY_ERROR_CODE_FORM = {
  code: '',
  category: '',
  severity: 'error',
  titleJa: '',
  descriptionJa: '',
  resolutionJa: '',
};

function ErrorCodesTab() {
  const { data: errorCodes, loading, error, reload } = useAsyncResource(
    useCallback((signal: AbortSignal) =>
      api.get<ErrorCodesResponse>('/admin/error-codes', { signal }).then((r) => r.items),
    []),
  );
  const [form, setForm] = useState(EMPTY_ERROR_CODE_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.titleJa.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editingId !== null) {
        await api.put(`/admin/error-codes/${editingId}`, {
          ...form,
          descriptionJa: form.descriptionJa || null,
          resolutionJa: form.resolutionJa || null,
        });
      } else {
        await api.post('/admin/error-codes', {
          ...form,
          descriptionJa: form.descriptionJa || null,
          resolutionJa: form.resolutionJa || null,
        });
      }
      setForm(EMPTY_ERROR_CODE_FORM);
      setEditingId(null);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (ec: ErrorCode) => {
    setEditingId(ec.id);
    setForm({
      code: ec.code,
      category: ec.category,
      severity: ec.severity,
      titleJa: ec.titleJa,
      descriptionJa: ec.descriptionJa ?? '',
      resolutionJa: ec.resolutionJa ?? '',
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(EMPTY_ERROR_CODE_FORM);
  };

  return (
    <>
      {(error || saveError) && (
        <AppAlert variant="danger" className="mb-3">
          {error || saveError}
        </AppAlert>
      )}

      <AppCard className="mb-3">
        <AppCard.Body>
          <AppCard.Title className="h6 mb-3">
            {editingId !== null ? 'エラーコード編集' : 'エラーコード追加'}
          </AppCard.Title>
          <Row className="g-2 mb-2">
            <Col md={2}>
              <AppControl
                placeholder="コード (例: E001)"
                value={form.code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, code: e.target.value }))
                }
              />
            </Col>
            <Col md={2}>
              <AppControl
                placeholder="カテゴリ"
                value={form.category}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, category: e.target.value }))
                }
              />
            </Col>
            <Col md={2}>
              <AppSelect
                value={form.severity}
                ariaLabel="重大度"
                onChange={(value) => setForm((prev) => ({ ...prev, severity: value }))}
                options={SEVERITY_OPTIONS}
              />
            </Col>
            <Col md={3}>
              <AppControl
                placeholder="タイトル（日本語）"
                value={form.titleJa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, titleJa: e.target.value }))
                }
              />
            </Col>
            <Col md={3}>
              <AppControl
                placeholder="説明（日本語）"
                value={form.descriptionJa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, descriptionJa: e.target.value }))
                }
              />
            </Col>
          </Row>
          <Row className="g-2">
            <Col md={6}>
              <AppControl
                placeholder="対処法（日本語）"
                value={form.resolutionJa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, resolutionJa: e.target.value }))
                }
              />
            </Col>
            <Col md={6} className="d-flex gap-2 align-items-start">
              <AppButton
                size="sm"
                variant="primary"
                onClick={() => void handleSubmit()}
                disabled={saving || !form.code.trim() || !form.titleJa.trim()}
              >
                {saving ? '保存中...' : editingId !== null ? '更新' : '追加'}
              </AppButton>
              {editingId !== null && (
                <AppButton size="sm" variant="outline-secondary" onClick={handleCancel}>
                  キャンセル
                </AppButton>
              )}
            </Col>
          </Row>
        </AppCard.Body>
      </AppCard>

      {loading ? (
        <InlineLoader text="エラーコードを読み込み中..." className="text-muted small mb-3" />
      ) : !errorCodes?.length ? (
        <AppAlert variant="secondary">エラーコードが登録されていません。</AppAlert>
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm" className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>コード</th>
                    <th>カテゴリ</th>
                    <th>重大度</th>
                    <th>タイトル</th>
                    <th>説明</th>
                    <th>対処法</th>
                    <th>状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {errorCodes?.map((ec) => (
                    <tr key={ec.id}>
                      <td>{ec.id}</td>
                      <td><code>{ec.code}</code></td>
                      <td className="small">{ec.category}</td>
                      <td><LevelBadge level={ec.severity} /></td>
                      <td className="small">{ec.titleJa}</td>
                      <td className="small text-muted">{ec.descriptionJa ?? '-'}</td>
                      <td className="small text-muted">{ec.resolutionJa ?? '-'}</td>
                      <td>
                        <Badge bg={ec.isActive ? 'success' : 'secondary'}>
                          {ec.isActive ? '有効' : '無効'}
                        </Badge>
                      </td>
                      <td>
                        <AppButton size="sm" variant="outline-primary" onClick={() => handleEdit(ec)}>
                          編集
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {errorCodes?.map((ec) => (
                <AppMobileDataCard
                  key={ec.id}
                  title={`${ec.code}: ${ec.titleJa}`}
                  subtitle={ec.category}
                  badges={
                    <>
                      <LevelBadge level={ec.severity} />
                      <Badge bg={ec.isActive ? 'success' : 'secondary'}>
                        {ec.isActive ? '有効' : '無効'}
                      </Badge>
                    </>
                  }
                  fields={[
                    { label: '説明', value: ec.descriptionJa ?? '-' },
                    { label: '対処法', value: ec.resolutionJa ?? '-' },
                  ]}
                  actions={
                    <AppButton size="sm" variant="outline-primary" onClick={() => handleEdit(ec)}>
                      編集
                    </AppButton>
                  }
                />
              ))}
            </div>
          )}
        />
      )}
    </>
  );
}

// --- Command History Tab ---

function CommandHistoryTab() {
  const { data: commands, loading, error, reload } = useAsyncResource(
    useCallback((signal: AbortSignal) =>
      api.get<CommandsResponse>('/openclaw/commands/history', { signal }).then((r) => r.commands),
    []),
  );

  const getStatusBadge = (status: string) => {
    const bg = COMMAND_STATUS_BADGE[status] ?? 'secondary';
    return <Badge bg={bg}>{status}</Badge>;
  };

  return (
    <>
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void reload()} />
      )}

      {loading ? (
        <InlineLoader text="コマンド履歴を読み込み中..." className="text-muted small mb-3" />
      ) : !commands?.length ? (
        <AppAlert variant="secondary">コマンド履歴がありません。</AppAlert>
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm" className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>コマンド名</th>
                    <th>パラメータ</th>
                    <th>ステータス</th>
                    <th>結果</th>
                    <th>エラー</th>
                    <th>スレッドID</th>
                    <th>受信日時</th>
                    <th>完了日時</th>
                  </tr>
                </thead>
                <tbody>
                  {commands?.map((cmd) => (
                    <tr key={cmd.id}>
                      <td>{cmd.id}</td>
                      <td><code>{cmd.commandName}</code></td>
                      <td className="small text-muted">{cmd.parameters ?? '-'}</td>
                      <td>{getStatusBadge(cmd.status)}</td>
                      <td className="small">{cmd.result ?? '-'}</td>
                      <td className="small text-danger">{cmd.errorMessage ?? '-'}</td>
                      <td className="small text-muted">{cmd.openclawThreadId ?? '-'}</td>
                      <td className="small">{formatDateTimeJa(cmd.receivedAt)}</td>
                      <td className="small">{cmd.completedAt ? formatDateTimeJa(cmd.completedAt) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {commands?.map((cmd) => (
                <AppMobileDataCard
                  key={cmd.id}
                  title={cmd.commandName}
                  subtitle={formatDateTimeJa(cmd.receivedAt)}
                  badges={getStatusBadge(cmd.status)}
                  fields={[
                    { label: 'パラメータ', value: cmd.parameters ?? '-' },
                    { label: '結果', value: cmd.result ?? '-' },
                    { label: 'エラー', value: cmd.errorMessage ?? '-' },
                    { label: 'スレッドID', value: cmd.openclawThreadId ?? '-' },
                    { label: '完了日時', value: cmd.completedAt ? formatDateTimeJa(cmd.completedAt) : '-' },
                  ]}
                />
              ))}
            </div>
          )}
        />
      )}
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
