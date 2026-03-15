import { useState, useEffect, memo, useCallback } from 'react';
import { Row, Col, Form } from 'react-bootstrap';
import AppAlert from '../../../components/ui/AppAlert';
import AppButton from '../../../components/ui/AppButton';
import AppCard from '../../../components/ui/AppCard';
import AppSelect from '../../../components/ui/AppSelect';
import AppModalShell from '../../../components/ui/AppModalShell';
import InlineLoader from '../../../components/ui/InlineLoader';
import { api } from '../../../api/client';
import { formatDateTimeJa } from '../../../utils/formatters';
import type {
  NormalizedLogEntry,
  LogInsightItem,
  LogCenterOpenClawResponse,
  LogIssueWorkflowStatus,
  LogIssueHistoryEntry,
  LogIssueHistoryResponse,
  LogIssueStatusResponse,
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

const LOG_STATUS_OPTIONS = [
  { value: 'new', label: LOG_STATUS_LABELS.new },
  { value: 'investigating', label: LOG_STATUS_LABELS.investigating },
  { value: 'resolved', label: LOG_STATUS_LABELS.resolved },
  { value: 'false_positive', label: LOG_STATUS_LABELS.false_positive },
];

type ActionStatusKind = 'success' | 'error' | 'info';

interface ActionStatusState {
  kind: ActionStatusKind;
  message: string;
}

export function getActionStatusAlertVariant(kind: ActionStatusKind): 'success' | 'warning' | 'info' {
  if (kind === 'error') return 'warning';
  if (kind === 'info') return 'info';
  return 'success';
}

function renderTenant(entry: NormalizedLogEntry) {
  if (!entry.tenant.tenantLabel) return '-';
  if (entry.tenant.pharmacyEmail) {
    return `${entry.tenant.tenantLabel} (${entry.tenant.pharmacyEmail})`;
  }
  return entry.tenant.tenantLabel;
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

interface LogDetailModalProps {
  entry: NormalizedLogEntry | null;
  insight: LogInsightItem | null;
  show: boolean;
  onHide: () => void;
  onStatusChanged: () => Promise<void> | void;
}

export const LogDetailModal = memo(function LogDetailModal({
  entry,
  insight,
  show,
  onHide,
  onStatusChanged,
}: LogDetailModalProps) {
  const [note, setNote] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState<LogIssueWorkflowStatus>('new');
  const [copyStatus, setCopyStatus] = useState('');
  const [actionStatus, setActionStatus] = useState<ActionStatusState | null>(null);
  const [sending, setSending] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<LogIssueHistoryEntry[]>([]);

  useEffect(() => {
    if (!show) {
      setNote('');
      setStatusNote('');
      setCopyStatus('');
      setActionStatus(null);
      setHistory([]);
    }
  }, [show]);

  useEffect(() => {
    if (!show || !entry) return;
    setWorkflowStatus(entry.operatorState.status);
    setStatusNote(entry.operatorState.note ?? '');
    const ac = new AbortController();
    setHistoryLoading(true);
    void api.get<LogIssueHistoryResponse>(`/admin/log-center/status-history?source=${entry.source}&logId=${entry.id}`, { signal: ac.signal })
      .then((result) => {
        if (!ac.signal.aborted) setHistory(result.history);
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          setActionStatus({
            kind: 'error',
            message: err instanceof Error ? err.message : 'ステータス履歴の取得に失敗しました。',
          });
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setHistoryLoading(false);
      });
    return () => ac.abort();
  }, [entry, show]);

  const handleCopyDetail = useCallback(async () => {
    if (!entry) return;
    try {
      const ok = await copyTextToClipboard(buildLogIssueDraft(entry, insight));
      setCopyStatus(ok ? 'ログ共有用テキストをコピーしました。' : 'このブラウザではクリップボードにコピーできません。');
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : 'コピーに失敗しました。');
    }
  }, [entry, insight]);

  const handleCopyCodeLocation = useCallback(async () => {
    if (!entry?.codeLocation) return;
    try {
      const ok = await copyTextToClipboard(entry.codeLocation);
      setCopyStatus(ok ? '発生コードをコピーしました。' : 'このブラウザではクリップボードにコピーできません。');
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : 'コピーに失敗しました。');
    }
  }, [entry]);

  const handleCopyJson = useCallback(async () => {
    if (!entry) return;
    try {
      const ok = await copyTextToClipboard(buildLogJsonDraft(entry, insight));
      setCopyStatus(ok ? '詳細 JSON をコピーしました。' : 'このブラウザではクリップボードにコピーできません。');
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : 'コピーに失敗しました。');
    }
  }, [entry, insight]);

  const handleEscalateToOpenClaw = useCallback(async () => {
    if (!entry) return;
    setSending(true);
    setActionStatus(null);
    try {
      const result = await api.post<LogCenterOpenClawResponse>('/admin/log-center/openclaw', {
        source: entry.source,
        logId: entry.id,
        note: note.trim() || undefined,
      });
      setActionStatus({
        kind: 'success',
        message: `OpenClaw へ通知しました。再発 ${result.recurrenceCount} 件、影響テナント ${result.impactedTenantCount} 件。`,
      });
    } catch (err) {
      setActionStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'OpenClaw 通知に失敗しました。',
      });
    } finally {
      setSending(false);
    }
  }, [entry, note]);

  const handleSaveStatus = useCallback(async () => {
    if (!entry) return;
    setStatusSaving(true);
    setActionStatus(null);
    try {
      const result = await api.patch<LogIssueStatusResponse>('/admin/log-center/status', {
        source: entry.source,
        logId: entry.id,
        status: workflowStatus,
        note: statusNote.trim() || undefined,
      });
      setStatusNote(result.currentState.note ?? '');
      setHistory(result.history);
      setActionStatus({
        kind: 'success',
        message: 'ログステータスを更新しました。',
      });
      await onStatusChanged();
    } catch (err) {
      setActionStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'ログステータスの更新に失敗しました。',
      });
    } finally {
      setStatusSaving(false);
    }
  }, [entry, workflowStatus, statusNote, onStatusChanged]);

  if (!entry) return null;

  const detailText = typeof entry.detail === 'string'
    ? entry.detail
    : JSON.stringify(entry.detail, null, 2);
  const recurrenceCount = insight?.count ?? 1;
  const impactedTenantCount = insight?.impactedTenantCount ?? (entry.tenant.pharmacyId != null ? 1 : 0);

  return (
    <AppModalShell
      show={show}
      onHide={onHide}
      size="xl"
      title={<span className="h6 mb-0">ログ詳細 #{entry.id}</span>}
      footer={(
        <div className="d-flex justify-content-between w-100 flex-wrap gap-2">
          <div className="d-flex gap-2 flex-wrap">
            <AppButton size="sm" variant="outline-secondary" onClick={() => void handleCopyCodeLocation()} disabled={!entry.codeLocation}>
              発生コードをコピー
            </AppButton>
            <AppButton size="sm" variant="outline-primary" onClick={() => void handleCopyDetail()}>
              共有テキストをコピー
            </AppButton>
            <AppButton size="sm" variant="outline-secondary" onClick={() => void handleCopyJson()}>
              JSON をコピー
            </AppButton>
            <AppButton size="sm" variant="primary" onClick={() => void handleEscalateToOpenClaw()} disabled={sending}>
              {sending ? '送信中...' : 'OpenClaw に通知'}
            </AppButton>
          </div>
          <AppButton size="sm" variant="secondary" onClick={onHide}>
            閉じる
          </AppButton>
        </div>
      )}
    >
      {copyStatus && (
        <AppAlert variant="info" className="mb-3">
          {copyStatus}
        </AppAlert>
      )}
      {actionStatus && (
        <AppAlert variant={getActionStatusAlertVariant(actionStatus.kind)} className="mb-3">
          {actionStatus.message}
        </AppAlert>
      )}

      <Row className="g-3 mb-3">
        <Col md={6}>
          <AppCard body className="h-100">
            <div className="small text-muted">何が起きたか</div>
            <div className="fw-semibold">{entry.whatHappened}</div>
            <div className="small text-muted mt-2">改善方法</div>
            <div className="small">{entry.improvementSuggestion ?? '-'}</div>
          </AppCard>
        </Col>
        <Col md={6}>
          <AppCard body className="h-100">
            <div className="small text-muted">影響と再発</div>
            <div className="small mt-1">テナント: {renderTenant(entry)}</div>
            <div className="small">運用状態: {LOG_STATUS_LABELS[workflowStatus]}</div>
            <div className="small">再発回数: {recurrenceCount}</div>
            <div className="small">影響テナント数: {impactedTenantCount}</div>
            <div className="small">発生コード: <span className="font-monospace">{entry.codeLocation ?? '-'}</span></div>
          </AppCard>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col md={6}>
          <AppCard body className="h-100">
            <div className="small text-muted">メタデータ</div>
            <div className="small mt-1">ソース: {SOURCE_LABELS[entry.source] ?? entry.source}</div>
            <div className="small">レベル: {entry.level}</div>
            <div className="small">カテゴリ: {entry.category}</div>
            <div className="small">エラーコード: {entry.errorCode ?? '-'}</div>
            <div className="small">発生日時: {formatDateTimeJa(entry.timestamp)}</div>
          </AppCard>
        </Col>
        <Col md={6}>
          <AppCard body className="h-100">
            <div className="small text-muted mb-2">運用ステータス</div>
            <AppSelect
              value={workflowStatus}
              ariaLabel="ログステータス"
              onChange={(value) => setWorkflowStatus(value as LogIssueWorkflowStatus)}
              options={LOG_STATUS_OPTIONS}
            />
            <div className="small text-muted mt-3">ステータスメモ</div>
            <Form.Control
              as="textarea"
              rows={5}
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="調査結果や次アクションを記入"
            />
            <div className="mt-2">
              <AppButton size="sm" variant="outline-primary" onClick={() => void handleSaveStatus()} disabled={statusSaving}>
                {statusSaving ? '保存中...' : 'ステータス保存'}
              </AppButton>
            </div>
          </AppCard>
        </Col>
      </Row>

      <Row className="g-3">
        <Col md={6}>
          <AppCard body>
            <div className="small text-muted mb-2">OpenClaw 注記</div>
            <Form.Control
              as="textarea"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="OpenClaw に添付する調査メモや影響範囲を記入"
            />
          </AppCard>
        </Col>
        <Col md={6}>
          <AppCard body>
            <div className="small text-muted mb-2">ステータス履歴</div>
            {historyLoading ? (
              <InlineLoader text="履歴を読み込み中..." className="text-muted small" />
            ) : history.length === 0 ? (
              <div className="small text-muted">履歴はまだありません。</div>
            ) : (
              <div className="small d-flex flex-column gap-2">
                {history.map((item) => (
                  <div key={item.id} className="border rounded p-2">
                    <div className="fw-semibold">
                      {item.kind === 'auto_escalation'
                        ? '自動 OpenClaw 通知'
                        : `ステータス更新: ${item.status ? LOG_STATUS_LABELS[item.status] : '-'}`}
                    </div>
                    <div className="text-muted">{formatDateTimeJa(item.createdAt)}</div>
                    {item.note ? <div>{item.note}</div> : null}
                    {item.reasonCodes.length > 0 ? <div>理由: {item.reasonCodes.join(', ')}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </AppCard>
        </Col>
      </Row>

      <AppCard body className="mt-3">
        <div className="small text-muted mb-2">エラー詳細 JSON</div>
        <pre className="small mb-0 text-wrap" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {detailText || '-'}
        </pre>
      </AppCard>
    </AppModalShell>
  );
});
