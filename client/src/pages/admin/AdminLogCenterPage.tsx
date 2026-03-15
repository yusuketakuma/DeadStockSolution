import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Tabs, Tab } from 'react-bootstrap';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppCard from '../../components/ui/AppCard';
import AppSelect from '../../components/ui/AppSelect';
import AppTable from '../../components/ui/AppTable';
import LazyTab from '../../components/ui/LazyTab';
import { api } from '../../api/client';
import { formatDateTimeJa } from '../../utils/formatters';
import ErrorCodesTab from './components/ErrorCodesTab';
import CommandHistoryTab from './components/CommandHistoryTab';
import { SummaryCards, InsightCards } from './components/AdminLogCenterSummaryCards';
import { LogEntriesView } from './components/AdminLogCenterLogEntriesView';
import { getActionStatusAlertVariant } from './components/AdminLogCenterLogDetailModal';
import type {
  LogCenterSummary,
  LogInsightsSummary,
  LogCenterOpenClawResponse,
} from '../../types/admin-log-center';

const LOG_SOURCE_TABS = [
  { key: 'activity_logs', title: '操作ログ' },
  { key: 'system_events', title: 'システムイベント' },
  { key: 'drug_master_sync_logs', title: '同期ログ' },
] as const;

type TabKey = 'all' | (typeof LOG_SOURCE_TABS)[number]['key'] | 'error_codes' | 'command_history';

const SOURCE_LABELS: Record<string, string> = {
  activity_logs: '操作ログ',
  system_events: 'システムイベント',
  drug_master_sync_logs: '同期ログ',
};

type ActionStatusKind = 'success' | 'error' | 'info';

interface ActionStatusState {
  kind: ActionStatusKind;
  message: string;
}

function buildIssueSummary(issue: { title: string; source: string; errorCode?: string | null; count: number; impactedTenantCount: number; latestOccurredAt: string; codeLocation?: string | null }): string {
  return [
    `論点: ${issue.title}`,
    `ソース: ${SOURCE_LABELS[issue.source] ?? issue.source}`,
    `エラーコード: ${issue.errorCode ?? 'N/A'}`,
    `再発回数: ${issue.count}`,
    `影響テナント数: ${issue.impactedTenantCount}`,
    `最新発生: ${issue.latestOccurredAt}`,
    `発生コード: ${issue.codeLocation ?? '不明'}`,
  ].join('\n');
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!navigator?.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

function SourceLabel({ source }: { source: string }) {
  return <>{SOURCE_LABELS[source] ?? source}</>;
}

export default function AdminLogCenterPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [summary, setSummary] = useState<LogCenterSummary | null>(null);
  const [insights, setInsights] = useState<LogInsightsSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [insightError, setInsightError] = useState('');
  const [minOccurrences, setMinOccurrences] = useState('2');
  const [topLimit, setTopLimit] = useState('10');
  const [issueActionStatus, setIssueActionStatus] = useState<ActionStatusState | null>(null);

  const activeSourceForInsights = activeTab === 'all' || activeTab === 'error_codes' || activeTab === 'command_history'
    ? ''
    : activeTab;

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

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams();
        if (activeSourceForInsights) params.set('source', activeSourceForInsights);
        if (minOccurrences) params.set('minOccurrences', minOccurrences);
        if (topLimit) params.set('topLimit', topLimit);
        const res = await api.get<LogInsightsSummary>(`/admin/log-center/insights?${params.toString()}`, { signal: ac.signal });
        if (!ac.signal.aborted) setInsights(res);
      } catch (err) {
        if (ac.signal.aborted) return;
        setInsightError(err instanceof Error ? err.message : '再発監視の取得に失敗しました');
      }
    })();
    return () => ac.abort();
  }, [activeSourceForInsights, minOccurrences, topLimit]);

  const handleCopyIssue = useCallback(async (issue: { title: string; source: string; errorCode?: string | null; count: number; impactedTenantCount: number; latestOccurredAt: string; codeLocation?: string | null }) => {
    try {
      const ok = await copyTextToClipboard(buildIssueSummary(issue));
      setIssueActionStatus({
        kind: 'info',
        message: ok ? '集約論点の要約をコピーしました。' : 'このブラウザではクリップボードにコピーできません。',
      });
    } catch (err) {
      setIssueActionStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'コピーに失敗しました。',
      });
    }
  }, []);

  const handleEscalateIssue = useCallback(async (issue: { source: string; sampleLogId: number; fingerprint: string }) => {
    try {
      setIssueActionStatus(null);
      const result = await api.post<LogCenterOpenClawResponse>('/admin/log-center/openclaw', {
        source: issue.source,
        logId: issue.sampleLogId,
        note: `Recurring issue escalation from admin log center. fingerprint=${issue.fingerprint}`,
      });
      setIssueActionStatus({
        kind: 'success',
        message: `集約論点を OpenClaw に通知しました。再発 ${result.recurrenceCount} 件、影響テナント ${result.impactedTenantCount} 件。`,
      });
    } catch (err) {
      setIssueActionStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'OpenClaw 通知に失敗しました。',
      });
    }
  }, []);

  return (
    <div className="page-viewport">
      <h4 className="page-title mb-3">ログセンター</h4>

      {summaryError && (
        <AppAlert variant="warning" className="mb-3">
          {summaryError}
        </AppAlert>
      )}
      {insightError && (
        <AppAlert variant="warning" className="mb-3">
          {insightError}
        </AppAlert>
      )}
      {issueActionStatus && (
        <AppAlert variant={getActionStatusAlertVariant(issueActionStatus.kind)} className="mb-3">
          {issueActionStatus.message}
        </AppAlert>
      )}

      <SummaryCards summary={summary} />
      <InsightCards insights={insights} />
      <Row className="g-2 mb-3">
        <Col md={4}>
          <AppSelect
            value={minOccurrences}
            ariaLabel="再発閾値"
            onChange={setMinOccurrences}
            options={[
              { value: '2', label: '2回以上' },
              { value: '3', label: '3回以上' },
              { value: '5', label: '5回以上' },
            ]}
          />
        </Col>
        <Col md={4}>
          <AppSelect
            value={topLimit}
            ariaLabel="集約論点の上限"
            onChange={setTopLimit}
            options={[
              { value: '5', label: '上位5件' },
              { value: '10', label: '上位10件' },
              { value: '20', label: '上位20件' },
            ]}
          />
        </Col>
        <Col md={4} className="d-flex align-items-center">
          <div className="small text-muted">
            {activeSourceForInsights
              ? `${SOURCE_LABELS[activeSourceForInsights]} の集約論点を表示中`
              : '全ソース横断の集約論点を表示中'}
          </div>
        </Col>
      </Row>
      <AppCard body className="mb-3">
        {!insights || insights.topIssues.length === 0 ? (
          <div className="small text-muted">再発中の high-signal なエラーはまだありません。</div>
        ) : (
          <div className="table-responsive">
            <AppTable striped hover size="sm" className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>論点</th>
                  <th>回数</th>
                  <th>影響テナント</th>
                  <th>コード</th>
                  <th>最新発生</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {insights.topIssues.map((issue) => (
                  <tr key={issue.fingerprint}>
                    <td className="small">
                      <div>{issue.title}</div>
                      <div className="text-muted">{issue.errorCode ?? 'N/A'} / <SourceLabel source={issue.source} /></div>
                    </td>
                    <td className="small">{issue.count}</td>
                    <td className="small">{issue.impactedTenantCount}</td>
                    <td className="small font-monospace">{issue.codeLocation ?? '-'}</td>
                    <td className="small">{formatDateTimeJa(issue.latestOccurredAt)}</td>
                    <td className="small">
                      <div className="d-flex gap-2 flex-wrap">
                        <AppButton size="sm" variant="outline-secondary" onClick={() => void handleCopyIssue(issue)}>
                          コピー
                        </AppButton>
                        <AppButton size="sm" variant="outline-primary" onClick={() => void handleEscalateIssue(issue)}>
                          OpenClaw 通知
                        </AppButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
          </div>
        )}
      </AppCard>

      <Tabs
        activeKey={activeTab}
        onSelect={(k) => setActiveTab((k ?? 'all') as TabKey)}
        className="mb-3"
      >
        <Tab eventKey="all" title="全て">
          <LogEntriesView sourceFilter="" insights={insights} />
        </Tab>
        {LOG_SOURCE_TABS.map(({ key, title }) => (
          <Tab key={key} eventKey={key} title={title}>
            <LazyTab active={activeTab === key}>
              <LogEntriesView sourceFilter={key} insights={insights} />
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
