import { Badge } from 'react-bootstrap';
import AppTable from '../../../components/ui/AppTable';
import AppCard from '../../../components/ui/AppCard';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';
import { formatDateTimeJa } from '../../../utils/formatters';

interface SyncLog {
  id: number;
  sourceDescription: string | null;
  status: string;
  itemsProcessed: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsDeleted: number;
  errorMessage: string | null;
  startedAt: string | null;
}

interface SyncLogsTableProps {
  syncLogs: SyncLog[];
}

function getSyncStatusBadge(status: string): { variant: string; label: string } {
  switch (status) {
    case 'success':
      return { variant: 'success', label: '成功' };
    case 'running':
      return { variant: 'primary', label: '実行中' };
    case 'failed':
      return { variant: 'danger', label: '失敗' };
    default:
      return { variant: 'secondary', label: status };
  }
}

export default function SyncLogsTable({ syncLogs }: SyncLogsTableProps) {
  if (syncLogs.length === 0) return null;

  return (
    <AppCard className="mb-3">
      <AppCard.Header>同期ログ（最新5件）</AppCard.Header>
      <AppCard.Body className="p-0">
        <AppResponsiveSwitch
          desktop={() => (
            <AppTable size="sm" responsive className="mb-0">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>状態</th>
                  <th>ソース</th>
                  <th>処理</th>
                  <th>追加</th>
                  <th>更新</th>
                  <th>削除</th>
                  <th>エラー</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => {
                  const badge = getSyncStatusBadge(log.status);
                  return (
                  <tr key={log.id}>
                    <td className="small">{formatDateTimeJa(log.startedAt)}</td>
                    <td>
                      <Badge bg={badge.variant}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="small text-truncate sync-log-source">{log.sourceDescription || '-'}</td>
                    <td>{log.itemsProcessed}</td>
                    <td>{log.itemsAdded}</td>
                    <td>{log.itemsUpdated}</td>
                    <td>{log.itemsDeleted}</td>
                    <td className="small text-danger text-truncate sync-log-error">{log.errorMessage || '-'}</td>
                  </tr>
                  );
                })}
              </tbody>
            </AppTable>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list p-3">
              {syncLogs.map((log) => {
                const badge = getSyncStatusBadge(log.status);
                return (
                <AppMobileDataCard
                  key={log.id}
                  title={formatDateTimeJa(log.startedAt)}
                  badges={(
                    <Badge bg={badge.variant}>
                      {badge.label}
                    </Badge>
                  )}
                  fields={[
                    { label: 'ソース', value: log.sourceDescription || '-' },
                    { label: '処理', value: log.itemsProcessed },
                    { label: '追加', value: log.itemsAdded },
                    { label: '更新', value: log.itemsUpdated },
                    { label: '削除', value: log.itemsDeleted },
                    { label: 'エラー', value: log.errorMessage || '-' },
                  ]}
                />
                );
              })}
            </div>
          )}
        />
      </AppCard.Body>
    </AppCard>
  );
}
