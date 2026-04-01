import { Badge } from 'react-bootstrap';
import AppCard from '../../ui/AppCard';
import AppTable from '../../ui/AppTable';
import AppSelect from '../../ui/AppSelect';
import InlineLoader from '../../ui/InlineLoader';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { OpenClawRetryItem, OpenClawRetryResponse } from './types';

interface OpenClawRetryQueueCardProps {
  retryItems: OpenClawRetryItem[];
  retryStats: OpenClawRetryResponse['stats'] | null;
  retryLoading: boolean;
  retryStatusFilter: 'all' | 'pending' | 'processing' | 'completed' | 'failed';
  onRetryStatusFilterChange: (value: string) => void;
}

/** リトライキュー表示カード */
export default function OpenClawRetryQueueCard({
  retryItems,
  retryStats,
  retryLoading,
  retryStatusFilter,
  onRetryStatusFilterChange,
}: OpenClawRetryQueueCardProps) {
  return (
    <AppCard className="mb-3">
      <AppCard.Header>Retry Queue</AppCard.Header>
      <AppCard.Body>
        <div className="d-flex gap-2 align-items-center flex-wrap mb-3">
          <Badge bg="secondary">pending: {retryStats?.pending ?? 0}</Badge>
          <Badge bg="primary">processing: {retryStats?.processing ?? 0}</Badge>
          <Badge bg="success">completed: {retryStats?.completed ?? 0}</Badge>
          <Badge bg="danger">failed: {retryStats?.failed ?? 0}</Badge>
          <AppSelect
            size="sm"
            value={retryStatusFilter}
            ariaLabel="retry status"
            onChange={onRetryStatusFilterChange}
            className="filter-select-compact"
            options={[
              { value: 'all', label: 'すべて' },
              { value: 'pending', label: 'pending' },
              { value: 'processing', label: 'processing' },
              { value: 'completed', label: 'completed' },
              { value: 'failed', label: 'failed' },
            ]}
          />
        </div>
        {retryLoading ? (
          <InlineLoader text="リトライキューを読み込み中..." className="text-muted small" />
        ) : retryItems.length === 0 ? (
          <div className="text-muted small">対象のリトライジョブはありません。</div>
        ) : (
          <div className="table-responsive">
            <AppTable striped size="sm" className="mobile-table mb-0">
              <thead>
                <tr>
                  <th>request</th>
                  <th>薬局</th>
                  <th>状態</th>
                  <th>attempt</th>
                  <th>次回</th>
                  <th>失敗理由</th>
                </tr>
              </thead>
              <tbody>
                {retryItems.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.requestId}</td>
                    <td>{item.pharmacyName}</td>
                    <td><Badge bg={item.status === 'failed' ? 'danger' : item.status === 'completed' ? 'success' : item.status === 'processing' ? 'primary' : 'secondary'}>{item.status}</Badge></td>
                    <td>{item.attemptCount}/{item.maxAttempts}</td>
                    <td>{formatDateTimeJa(item.nextRetryAt ?? item.lastAttemptAt)}</td>
                    <td className="small text-muted">{item.lastError ?? item.triggerReason ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
