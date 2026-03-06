import { useCallback } from 'react';
import { Badge } from 'react-bootstrap';
import AppAlert from '../../../components/ui/AppAlert';
import ErrorRetryAlert from '../../../components/ui/ErrorRetryAlert';
import AppTable from '../../../components/ui/AppTable';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import InlineLoader from '../../../components/ui/InlineLoader';
import { api } from '../../../api/client';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { CommandsResponse } from '../../../types/admin-log-center';

const COMMAND_STATUS_BADGE: Record<string, string> = {
  completed: 'success',
  failed: 'danger',
  pending: 'warning',
  running: 'primary',
};

export default function CommandHistoryTab() {
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
