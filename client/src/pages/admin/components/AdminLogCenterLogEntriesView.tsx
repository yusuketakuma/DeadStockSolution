import { useState, useEffect, useCallback, useRef, memo, type ChangeEvent } from 'react';
import { Row, Col } from 'react-bootstrap';
import AppAlert from '../../../components/ui/AppAlert';
import AppButton from '../../../components/ui/AppButton';
import ErrorRetryAlert from '../../../components/ui/ErrorRetryAlert';
import AppControl from '../../../components/ui/AppControl';
import AppSelect from '../../../components/ui/AppSelect';
import AppTable from '../../../components/ui/AppTable';
import AppDropdownMenu from '../../../components/ui/AppDropdownMenu';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import InlineLoader from '../../../components/ui/InlineLoader';
import LevelBadge from '../../../components/ui/LevelBadge';
import Pagination from '../../../components/Pagination';
import { api, buildApiUrl } from '../../../api/client';
import { usePaginatedList } from '../../../hooks/usePaginatedList';
import { formatDateTimeJa, truncatePreview } from '../../../utils/formatters';
import { LogDetailModal } from './AdminLogCenterLogDetailModal';
import type {
  NormalizedLogEntry,
  LogCenterResponse,
  LogInsightsSummary,
  LogInsightItem,
  LogIssueWorkflowStatus,
} from '../../../types/admin-log-center';

const SOURCE_LABELS: Record<string, string> = {
  activity_logs: '操作ログ',
  system_events: 'システムイベント',
  drug_master_sync_logs: '同期ログ',
};

const LOG_STATUS_LABELS: Record<LogIssueWorkflowStatus, string> = {
  new: '未対応',
  investigating: '調査中',
  resolved: '対応済み',
  false_positive: '誤検知',
};

const LEVEL_OPTIONS = [
  { value: '', label: '全てのレベル' },
  { value: 'critical', label: 'Critical' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

function levelLabel(level: string): string {
  return LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

function SourceLabel({ source }: { source: string }) {
  return <>{SOURCE_LABELS[source] ?? source}</>;
}

function renderTenant(entry: NormalizedLogEntry) {
  if (!entry.tenant.tenantLabel) return '-';
  if (entry.tenant.pharmacyEmail) {
    return `${entry.tenant.tenantLabel} (${entry.tenant.pharmacyEmail})`;
  }
  return entry.tenant.tenantLabel;
}

function renderOperatorState(entry: NormalizedLogEntry) {
  return LOG_STATUS_LABELS[entry.operatorState.status] ?? entry.operatorState.status;
}

function buildCellTitle(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildInsightFingerprint(entry: NormalizedLogEntry): string {
  return [
    entry.errorCode ?? 'no-code',
    entry.category,
    entry.codeLocation ?? 'unknown-location',
    entry.source,
  ].join('|');
}

function findInsightForEntry(entry: NormalizedLogEntry, insights: LogInsightsSummary | null): LogInsightItem | null {
  if (!insights) return null;
  const fingerprint = buildInsightFingerprint(entry);
  return insights.topIssues.find((issue) => issue.fingerprint === fingerprint) ?? null;
}

function buildLogIssueDraft(entry: NormalizedLogEntry, insight: LogInsightItem | null): string {
  return [
    `タイトル: ${entry.whatHappened}`,
    `テナント: ${renderTenant(entry)}`,
    `レベル: ${entry.level}`,
    `ソース: ${SOURCE_LABELS[entry.source] ?? entry.source}`,
    `ログID: ${entry.id}`,
    `発生日時: ${entry.timestamp}`,
    `エラーコード: ${entry.errorCode ?? 'N/A'}`,
    `発生コード: ${entry.codeLocation ?? '不明'}`,
    `再発回数: ${insight?.count ?? 1}`,
    `影響テナント数: ${insight?.impactedTenantCount ?? (entry.tenant.pharmacyId != null ? 1 : 0)}`,
    `改善案: ${entry.improvementSuggestion ?? '詳細ログを確認して例外処理を補強してください。'}`,
    `詳細: ${typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2)}`,
  ].join('\n');
}

function buildLogJsonDraft(entry: NormalizedLogEntry, insight: LogInsightItem | null): string {
  return JSON.stringify({
    id: entry.id,
    source: entry.source,
    level: entry.level,
    category: entry.category,
    errorCode: entry.errorCode,
    timestamp: entry.timestamp,
    whatHappened: entry.whatHappened,
    codeLocation: entry.codeLocation,
    improvementSuggestion: entry.improvementSuggestion,
    recurrenceCount: insight?.count ?? 1,
    impactedTenantCount: insight?.impactedTenantCount ?? (entry.tenant.pharmacyId != null ? 1 : 0),
    tenant: entry.tenant,
    detail: entry.detail,
  }, null, 2);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!navigator?.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

interface LogEntriesViewProps {
  sourceFilter: string;
  insights: LogInsightsSummary | null;
}

export const LogEntriesView = memo(function LogEntriesView({
  sourceFilter,
  insights,
}: LogEntriesViewProps) {
  const [levelFilter, setLevelFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<NormalizedLogEntry | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
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
    invalidateCache,
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
  const selectedInsight = selectedEntry ? findInsightForEntry(selectedEntry, insights) : null;
  const exportQuery = new URLSearchParams();
  if (sourceFilter) exportQuery.set('source', sourceFilter);
  if (levelFilter) exportQuery.set('level', levelFilter);
  if (keyword.trim()) exportQuery.set('search', keyword.trim());
  const activeFilters = [
    sourceFilter ? `ソース: ${SOURCE_LABELS[sourceFilter] ?? sourceFilter}` : null,
    levelFilter ? `レベル: ${levelLabel(levelFilter)}` : null,
    keyword.trim() ? `検索: ${keyword.trim()}` : null,
  ].filter((value): value is string => Boolean(value));

  const handleCopyEntry = useCallback(async (entry: NormalizedLogEntry) => {
    try {
      const ok = await copyTextToClipboard(buildLogIssueDraft(entry, findInsightForEntry(entry, insights)));
      setCopyStatus(ok ? `ログ #${entry.id} の共有テキストをコピーしました。` : 'このブラウザではクリップボードにコピーできません。');
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : 'コピーに失敗しました。');
    }
  }, [insights]);

  const handleCopyEntryJson = useCallback(async (entry: NormalizedLogEntry) => {
    try {
      const ok = await copyTextToClipboard(buildLogJsonDraft(entry, findInsightForEntry(entry, insights)));
      setCopyStatus(ok ? `ログ #${entry.id} の JSON をコピーしました。` : 'このブラウザではクリップボードにコピーできません。');
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : 'コピーに失敗しました。');
    }
  }, [insights]);

  const handleStatusChanged = useCallback(async () => {
    invalidateCache();
    await fetchPage(page, { force: true });
  }, [invalidateCache, fetchPage, page]);

  return (
    <>
      {copyStatus && (
        <AppAlert variant="info" className="mb-3">
          {copyStatus}
        </AppAlert>
      )}
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
            onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
          />
        </Col>
      </Row>

      {activeFilters.length > 0 && (
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div className="dl-badge-row">
            {activeFilters.map((filterLabel) => (
              <span key={filterLabel} className="badge bg-light text-dark border">
                {filterLabel}
              </span>
            ))}
          </div>
          {(levelFilter || keyword.trim()) && (
            <AppButton
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                setLevelFilter('');
                setKeyword('');
              }}
            >
              条件をクリア
            </AppButton>
          )}
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="small text-muted">
          {total}件{activeFilters.length > 0 ? ' / 絞り込み中' : ''}
        </div>
        <div className="dl-action-row mobile-stack">
          <a
            className="btn btn-sm btn-outline-primary"
            href={buildApiUrl(`/admin/log-center/export?${exportQuery.toString()}&format=json`)}
          >
            JSON Export
          </a>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              {
                key: 'csv-export',
                href: buildApiUrl(`/admin/log-center/export?${exportQuery.toString()}&format=csv`),
                label: 'CSV Export',
              },
            ]}
          />
        </div>
      </div>

      <div>
        {loading ? (
          <InlineLoader text="ログを読み込み中..." className="text-muted small mb-3" />
        ) : items.length === 0 ? (
          <AppAlert variant="secondary">ログデータがありません。</AppAlert>
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover size="sm" className="mobile-table dl-log-center-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>日時</th>
                      <th>レベル</th>
                      <th>ソース</th>
                      <th>カテゴリ</th>
                      <th>テナント</th>
                      <th>エラーコード</th>
                      <th>状態</th>
                      <th>何が起きたか</th>
                      <th>発生コード</th>
                      <th>再発</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry) => {
                      const insight = findInsightForEntry(entry, insights);
                      return (
                        <tr key={`${entry.source}-${entry.id}`}>
                          <td>{entry.id}</td>
                          <td className="small">{formatDateTimeJa(entry.timestamp)}</td>
                          <td><LevelBadge level={entry.level} /></td>
                          <td><SourceLabel source={entry.source} /></td>
                          <td className="small">
                            <div className="dl-log-center-cell dl-log-center-cell--compact" title={buildCellTitle(entry.category)}>
                              {entry.category}
                            </div>
                          </td>
                          <td className="small">
                            <div className="dl-log-center-cell dl-log-center-cell--compact" title={buildCellTitle(renderTenant(entry))}>
                              {renderTenant(entry)}
                            </div>
                          </td>
                          <td className="small">
                            <div className="dl-log-center-cell dl-log-center-cell--compact" title={buildCellTitle(entry.errorCode ?? '-')}>
                              {entry.errorCode ?? '-'}
                            </div>
                          </td>
                          <td className="small">{renderOperatorState(entry)}</td>
                          <td className="small">
                            <div
                              className="dl-log-center-cell dl-log-center-cell--headline"
                              title={buildCellTitle(entry.whatHappened)}
                            >
                              {entry.whatHappened}
                            </div>
                            <div
                              className="text-muted dl-log-center-cell dl-log-center-cell--subline"
                              title={buildCellTitle(entry.improvementSuggestion ?? '-')}
                            >
                              {truncatePreview(entry.improvementSuggestion ?? '-')}
                            </div>
                          </td>
                          <td className="small">
                            <div
                              className="font-monospace dl-log-center-code"
                              title={buildCellTitle(entry.codeLocation ?? '-')}
                            >
                              {entry.codeLocation ?? '-'}
                            </div>
                          </td>
                          <td className="small">
                            {insight ? `${insight.count}件 / ${insight.impactedTenantCount}テナント` : '-'}
                          </td>
                          <td className="small">
                            <div className="dl-action-row mobile-stack">
                              <AppButton size="sm" variant="outline-primary" onClick={() => setSelectedEntry(entry)}>
                                ログを確認
                              </AppButton>
                              <AppDropdownMenu
                                label="その他"
                                size="sm"
                                variant="outline-secondary"
                                items={[
                                  { label: 'コピー', onClick: () => { void handleCopyEntry(entry); } },
                                  { label: 'JSON', onClick: () => { void handleCopyEntryJson(entry); } },
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((entry) => {
                  const insight = findInsightForEntry(entry, insights);
                  return (
                    <AppMobileDataCard
                      key={`${entry.source}-${entry.id}`}
                      title={`ログ #${entry.id}`}
                      subtitle={formatDateTimeJa(entry.timestamp)}
                      badges={<LevelBadge level={entry.level} />}
                      actions={(
                        <div className="dl-action-row mobile-stack">
                          <AppButton size="sm" variant="outline-primary" onClick={() => setSelectedEntry(entry)}>
                            ログを確認
                          </AppButton>
                          <AppDropdownMenu
                            label="その他"
                            size="sm"
                            variant="outline-secondary"
                            items={[
                              { label: 'コピー', onClick: () => { void handleCopyEntry(entry); } },
                            ]}
                          />
                        </div>
                      )}
                      fields={[
                        { label: 'ソース', value: SOURCE_LABELS[entry.source] ?? entry.source },
                        { label: 'カテゴリ', value: entry.category },
                        { label: 'テナント', value: renderTenant(entry) },
                        { label: 'エラーコード', value: entry.errorCode ?? '-' },
                        { label: '状態', value: renderOperatorState(entry) },
                        { label: '何が起きたか', value: entry.whatHappened },
                        { label: '発生コード', value: entry.codeLocation ?? '-' },
                        { label: '改善方法', value: entry.improvementSuggestion ?? '-' },
                        { label: '再発', value: insight ? `${insight.count}件 / ${insight.impactedTenantCount}テナント` : '-' },
                        { label: '詳細', value: truncatePreview(entry.detail) },
                      ]}
                    />
                  );
                })}
              </div>
            )}
          />
        )}
      </div>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <LogDetailModal
        entry={selectedEntry}
        insight={selectedInsight}
        show={selectedEntry !== null}
        onHide={() => setSelectedEntry(null)}
        onStatusChanged={handleStatusChanged}
      />
    </>
  );
});
