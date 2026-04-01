import { Badge } from 'react-bootstrap';
import AppCard from '../../ui/AppCard';
import AppTable from '../../ui/AppTable';
import AppSelect from '../../ui/AppSelect';
import AppControl from '../../ui/AppControl';
import AppMobileDataCard from '../../ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../ui/AppResponsiveSwitch';
import InlineLoader from '../../ui/InlineLoader';
import LoadingButton from '../../ui/LoadingButton';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { UserRequestItem } from './types';
import { openclawStatusMeta, workflowStatusMeta } from './types';

interface OpenClawRequestListCardProps {
  connectorMeta: {
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  } | null;
  requests: UserRequestItem[];
  filteredRequests: UserRequestItem[];
  workflowCount: Record<string, number>;
  loading: boolean;
  statusFilter: string;
  searchText: string;
  handoffingRequestId: number | null;
  onStatusFilterChange: (value: string) => void;
  onSearchTextChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectRequest: (id: number) => void;
  onRetryHandoff: (id: number) => void;
}

/** 要望一覧（管理者専用）カード */
export default function OpenClawRequestListCard({
  connectorMeta,
  requests,
  filteredRequests,
  workflowCount,
  loading,
  statusFilter,
  searchText,
  handoffingRequestId,
  onStatusFilterChange,
  onSearchTextChange,
  onSelectRequest,
  onRetryHandoff,
}: OpenClawRequestListCardProps) {
  return (
    <AppCard>
      <AppCard.Header>要望一覧（管理者専用）</AppCard.Header>
      <AppCard.Body>
        <div className="small text-muted mb-2">
          Connector: {connectorMeta?.configured ? '接続済み' : '未接続'} /
          Webhook: {connectorMeta?.webhookConfigured ? '設定済み' : '未設定'} /
          実装許可ブランチ: <code>{connectorMeta?.implementationBranch ?? 'review'}</code>
        </div>
        <div className="small text-muted mb-3">
          OpenClaw から反映された状態を SSE で自動更新し、接続できない場合は約1分ごとに再取得します。
        </div>

        <div className="d-flex gap-2 align-items-center flex-wrap mb-3">
          <Badge bg="secondary">受付済み: {workflowCount.queued ?? 0}</Badge>
          <Badge bg="secondary">解析中: {workflowCount.analyzing ?? 0}</Badge>
          <Badge bg="primary">回答待ち: {workflowCount.awaiting_user ?? 0}</Badge>
          <Badge bg="warning" text="dark">実装中: {(workflowCount.implementing ?? 0) + (workflowCount.pr_opened ?? 0)}</Badge>
          <Badge bg="success">完了: {workflowCount.completed ?? 0}</Badge>
          <Badge bg="danger">失敗: {workflowCount.failed ?? 0}</Badge>
        </div>

        <div className="d-flex gap-2 flex-wrap mb-3">
          <AppSelect
            size="sm"
            value={statusFilter}
            ariaLabel="DSS状態で絞り込み"
            onChange={onStatusFilterChange}
            className="filter-select-compact"
            options={[
              { value: 'all', label: 'すべての状態' },
              { value: 'queued', label: '受付済み' },
              { value: 'analyzing', label: '解析中' },
              { value: 'awaiting_user', label: '回答待ち' },
              { value: 'implementing', label: '実装中' },
              { value: 'pr_opened', label: 'PR作成済み' },
              { value: 'completed', label: '完了' },
              { value: 'failed', label: '失敗' },
            ]}
          />
          <AppControl
            size="sm"
            placeholder="薬局名・要望内容で検索"
            value={searchText}
            onChange={onSearchTextChange}
            className="filter-input-compact"
          />
        </div>

        {loading ? (
          <InlineLoader text="読み込み中..." className="text-muted small" />
        ) : filteredRequests.length === 0 ? (
          <div className="text-muted small">
            {requests.length === 0 ? '受信した要望はまだありません。' : '条件に一致する要望はありません。'}
          </div>
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped size="sm" className="mobile-table mb-0">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>薬局</th>
                      <th>要望内容</th>
                      <th>OpenClaw状態</th>
                      <th>受付日時</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((item) => {
                      const status = openclawStatusMeta(item.openclawStatus);
                      const workflow = workflowStatusMeta(item.workflowStatus);
                      return (
                        <tr key={item.id}>
                          <td>
                            <button
                              type="button"
                              className="btn btn-link p-0 text-decoration-none"
                              onClick={() => onSelectRequest(item.id)}
                            >
                              {item.id}
                            </button>
                          </td>
                          <td>{item.pharmacyName} (ID: {item.pharmacyId})</td>
                          <td className="small">
                            <div>{item.requestText}</div>
                            {(item.latestSummary ?? item.openclawSummary) && <div className="text-muted mt-1">要約: {item.latestSummary ?? item.openclawSummary}</div>}
                            {item.openclawThreadId && <div className="text-muted mt-1">Thread: {item.openclawThreadId}</div>}
                            {item.prUrl && <div className="text-muted mt-1">PR: {item.prUrl}</div>}
                          </td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              <Badge bg={status.bg}>{status.label}</Badge>
                              <Badge bg={workflow.bg}>{workflow.label}</Badge>
                            </div>
                          </td>
                          <td>{formatDateTimeJa(item.createdAt)}</td>
                          <td>
                            {item.openclawStatus === 'pending_handoff' || item.workflowStatus === 'failed' ? (
                              <LoadingButton
                                size="sm"
                                variant="outline-primary"
                                disabled={handoffingRequestId !== null && handoffingRequestId !== item.id}
                                onClick={() => onRetryHandoff(item.id)}
                                loading={handoffingRequestId === item.id}
                                loadingLabel="再連携中..."
                              >
                                再連携
                              </LoadingButton>
                            ) : (
                              <span className="text-muted small">-</span>
                            )}
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
                {filteredRequests.map((item) => {
                  const status = openclawStatusMeta(item.openclawStatus);
                  const workflow = workflowStatusMeta(item.workflowStatus);
                  return (
                    <AppMobileDataCard
                      key={item.id}
                      title={`${item.pharmacyName} (ID: ${item.pharmacyId})`}
                      subtitle={`要望ID: ${item.id}`}
                      badges={(
                        <div className="d-flex gap-1 flex-wrap">
                          <Badge bg={status.bg}>{status.label}</Badge>
                          <Badge bg={workflow.bg}>{workflow.label}</Badge>
                        </div>
                      )}
                      fields={[
                        { label: '要望内容', value: item.requestText },
                        { label: '要約', value: item.latestSummary ?? item.openclawSummary ?? '-' },
                        { label: 'Thread', value: item.openclawThreadId || '-' },
                        { label: 'PR', value: item.prUrl || '-' },
                        { label: '受付日時', value: formatDateTimeJa(item.createdAt) },
                      ]}
                      actions={(
                        <div className="d-flex gap-2 align-items-center">
                          <LoadingButton
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => onSelectRequest(item.id)}
                            loading={false}
                            loadingLabel="読み込み中..."
                          >
                            詳細
                          </LoadingButton>
                          {item.openclawStatus === 'pending_handoff' || item.workflowStatus === 'failed' ? (
                            <LoadingButton
                              size="sm"
                              variant="outline-primary"
                              disabled={handoffingRequestId !== null && handoffingRequestId !== item.id}
                              onClick={() => onRetryHandoff(item.id)}
                              loading={handoffingRequestId === item.id}
                              loadingLabel="再連携中..."
                            >
                              再連携
                            </LoadingButton>
                          ) : (
                            <span className="text-muted small">操作不要</span>
                          )}
                        </div>
                      )}
                    />
                  );
                })}
              </div>
            )}
          />
        )}
      </AppCard.Body>
    </AppCard>
  );
}
