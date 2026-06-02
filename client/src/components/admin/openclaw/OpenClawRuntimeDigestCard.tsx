import { Badge } from 'react-bootstrap';
import AppCard from '../../ui/AppCard';
import AppMobileDataCard from '../../ui/AppMobileDataCard';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { DdsRuntimeDigest } from './types';

interface OpenClawRuntimeDigestCardProps {
  digest: DdsRuntimeDigest | null;
}

function severityBadge(severity: string): 'danger' | 'warning' | 'secondary' | 'success' | 'primary' {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'primary';
    case 'success':
      return 'success';
    default:
      return 'secondary';
  }
}

function statusBadge(status: string): 'danger' | 'warning' | 'secondary' | 'success' | 'primary' {
  switch (status) {
    case 'failed':
    case 'escalated':
      return 'danger';
    case 'dedup_skipped':
    case 'disabled':
      return 'secondary';
    case 'success':
      return 'success';
    default:
      return 'warning';
  }
}

export default function OpenClawRuntimeDigestCard({ digest }: OpenClawRuntimeDigestCardProps) {
  const latest = digest?.latestConnection ?? null;

  return (
    <AppCard className="mb-3">
      <AppCard.Header>DSS Runtime ログ</AppCard.Header>
      <AppCard.Body>
        {!digest ? (
          <div className="text-muted small">runtime digest を取得できませんでした。</div>
        ) : (
          <>
            <div className="dl-badge-row mb-3">
              <Badge bg={latest?.status === 'ok' ? 'success' : 'warning'}>
                最新状態 {latest?.status ?? 'unknown'}
              </Badge>
              <Badge bg="secondary">errors {digest.bufferedErrors.count}</Badge>
              <Badge bg="secondary">autofix 今日 {digest.codexResults.todayCount}</Badge>
              {latest?.source ? <Badge bg="secondary">{latest.source}</Badge> : null}
            </div>

            <div className="row g-2 mb-3">
              <div className="col-md-4 col-12">
                <AppMobileDataCard
                  title="最新ヘルス"
                  fields={[
                    { label: 'reason', value: latest?.reason ?? '-' },
                    { label: 'HTTP', value: latest?.healthHttpCode ?? '-' },
                    { label: 'runId', value: latest?.runId ?? '-' },
                    { label: 'lastSeen', value: formatDateTimeJa(latest?.health.lastSeenAt) },
                  ]}
                />
              </div>
              <div className="col-md-4 col-12">
                <AppMobileDataCard
                  title="通知 / 監視"
                  fields={[
                    { label: 'DM', value: latest?.notifications.telegramDmEnabled ? 'ON' : 'OFF' },
                    { label: 'Group', value: latest?.notifications.telegramGroupEnabled ? 'ON' : 'OFF' },
                    { label: 'AutoFix', value: latest?.notifications.codexAutofixEnabled ? 'ON' : 'OFF' },
                    { label: 'awaiting', value: latest?.health.awaitingUser ?? '-' },
                  ]}
                />
              </div>
              <div className="col-md-4 col-12">
                <AppMobileDataCard
                  title="バッファ / 結果"
                  fields={[
                    { label: 'error sources', value: Object.keys(digest.bufferedErrors.bySource).length },
                    { label: 'error severities', value: Object.keys(digest.bufferedErrors.bySeverity).length },
                    { label: 'autofix success', value: digest.codexResults.todayByStatus.success ?? 0 },
                    { label: 'generated', value: formatDateTimeJa(digest.generatedAt) },
                  ]}
                />
              </div>
            </div>

            <div className="row g-3">
              <div className="col-lg-6">
                <div className="fw-semibold small mb-2">最近のエラーイベント</div>
                {digest.bufferedErrors.recent.length === 0 ? (
                  <div className="text-muted small">buffered error はありません。</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {digest.bufferedErrors.recent.map((entry) => (
                      <div key={`${entry.ts}-${entry.code}-${entry.msg}`} className="border rounded p-3 bg-light">
                        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-1">
                          <div className="d-flex gap-1 flex-wrap">
                            <Badge bg={severityBadge(entry.severity)}>{entry.severity}</Badge>
                            <Badge bg="secondary">{entry.code}</Badge>
                            <Badge bg="secondary">{entry.source}</Badge>
                          </div>
                          <span className="text-muted small">{formatDateTimeJa(entry.ts)}</span>
                        </div>
                        <div className="small">{entry.msg}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-lg-6">
                <div className="fw-semibold small mb-2">最近の Auto-Fix</div>
                {digest.codexResults.recent.length === 0 ? (
                  <div className="text-muted small">auto-fix 実行履歴はありません。</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {digest.codexResults.recent.map((entry) => (
                      <div key={`${entry.ts}-${entry.type}-${entry.status}`} className="border rounded p-3 bg-white">
                        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-1">
                          <div className="d-flex gap-1 flex-wrap">
                            <Badge bg={statusBadge(entry.status)}>{entry.status}</Badge>
                            <Badge bg="secondary">{entry.type}</Badge>
                            <Badge bg="secondary">attempt {entry.attempt}/{entry.maxAttempts}</Badge>
                          </div>
                          <span className="text-muted small">{formatDateTimeJa(entry.ts)}</span>
                        </div>
                        <div className="small">{entry.summary}</div>
                        {entry.log ? (
                          <div className="text-muted small mt-1 text-break">log: {entry.log}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
