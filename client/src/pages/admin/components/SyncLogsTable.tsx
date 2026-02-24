import { Card, Table, Badge } from 'react-bootstrap';

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

export default function SyncLogsTable({ syncLogs }: SyncLogsTableProps) {
  if (syncLogs.length === 0) return null;

  return (
    <Card className="mb-3">
      <Card.Header>同期ログ（最新5件）</Card.Header>
      <Card.Body className="p-0">
        <Table size="sm" responsive className="mb-0">
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
            {syncLogs.map((log) => (
              <tr key={log.id}>
                <td className="small">{log.startedAt ? new Date(log.startedAt).toLocaleString('ja-JP') : '-'}</td>
                <td>
                  <Badge bg={log.status === 'success' ? 'success' : log.status === 'running' ? 'primary' : 'danger'}>
                    {log.status}
                  </Badge>
                </td>
                <td className="small text-truncate" style={{ maxWidth: 150 }}>{log.sourceDescription || '-'}</td>
                <td>{log.itemsProcessed}</td>
                <td>{log.itemsAdded}</td>
                <td>{log.itemsUpdated}</td>
                <td>{log.itemsDeleted}</td>
                <td className="small text-danger text-truncate" style={{ maxWidth: 200 }}>{log.errorMessage || '-'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
}
