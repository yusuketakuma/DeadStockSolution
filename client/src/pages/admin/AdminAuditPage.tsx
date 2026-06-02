import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Form } from 'react-bootstrap';
import { api, buildApiUrl } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppDataPanel from '../../components/ui/AppDataPanel';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';

interface AuditItem {
  id: number;
  adminId: number;
  adminName: string | null;
  targetPharmacyId: number;
  targetPharmacyName: string | null;
  action: string;
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  createdAt: string;
}

interface AuditResponse {
  data: AuditItem[];
  pagination: { page: number; totalPages: number; total: number };
}

const ACTION_LABELS: Record<string, string> = {
  verify: '承認',
  reject: '却下',
  're-review': '再審査',
};

const ACTION_COLORS: Record<string, string> = {
  verify: 'success',
  reject: 'danger',
  're-review': 'warning',
};

export default function AdminAuditPage() {
  const [actionFilter, setActionFilter] = useState('');

  const fetchAuditItems = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (actionFilter) params.set('action', actionFilter);
    return api.get<AuditResponse>(`/admin/audit?${params}`, { signal });
  }, [actionFilter]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<AuditItem, AuditResponse>(
    fetchAuditItems,
    { errorMessage: '監査ログの取得に失敗しました' },
  );

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">監査ログ</h4>
        </div>
        <div className="dl-page-header-actions mobile-stack">
          <Link to="/admin/logs" className="btn btn-primary btn-sm">操作ログ</Link>
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'log-center', to: '/admin/log-center', label: 'ログセンター' },
              { key: 'csv', href: buildApiUrl('/admin/csv/audit-logs'), label: 'CSVエクスポート', download: true },
            ]}
          />
        </div>
      </div>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        <AppDataPanel title="絞り込みと関連画面" className="mb-3">
          <div className="dl-action-row mobile-stack align-items-center">
            <Form.Select
              size="sm"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              style={{ maxWidth: 220 }}
              aria-label="監査アクション"
            >
              <option value="">すべてのアクション</option>
              {Object.entries(ACTION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Form.Select>
            <Link to="/admin/error-codes" className="btn btn-outline-primary btn-sm">エラーコード</Link>
            <AppDropdownMenu
              label="関連"
              size="sm"
              variant="outline-secondary"
              items={[
                { key: 'notifications', to: '/admin/notifications', label: '通知・配信' },
              ]}
            />
          </div>
          <div className="small text-muted mt-2">
            監査結果の確認、CSV 出力、その後の通知運用やコード更新までを同じ入口にまとめています。
          </div>
        </AppDataPanel>

        {loading ? (
          <InlineLoader text="監査ログを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState
            title="監査ログがありません"
            description="管理者操作が記録されるとここに表示されます。"
            actionLabel="ログセンターへ"
            actionTo="/admin/log-center"
          />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>管理者</th>
                      <th>対象薬局</th>
                      <th>アクション</th>
                      <th>ステータス変更</th>
                      <th>理由</th>
                      <th>日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id}>
                        <td>{a.id}</td>
                        <td>{a.adminName ?? `ID:${a.adminId}`}</td>
                        <td>{a.targetPharmacyName ?? `ID:${a.targetPharmacyId}`}</td>
                        <td>
                          <Badge bg={ACTION_COLORS[a.action] ?? 'secondary'}>
                            {ACTION_LABELS[a.action] ?? a.action}
                          </Badge>
                        </td>
                        <td className="small">
                          {a.previousStatus && <span className="text-muted">{a.previousStatus}</span>}
                          {a.previousStatus && ' → '}
                          <span className="fw-semibold">{a.newStatus}</span>
                        </td>
                        <td className="small text-muted">{a.reason ?? '—'}</td>
                        <td className="small">{formatDateTimeJa(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((a) => (
                  <AppMobileDataCard
                    key={a.id}
                    title={`${ACTION_LABELS[a.action] ?? a.action}: ${a.targetPharmacyName ?? `ID:${a.targetPharmacyId}`}`}
                    subtitle={`管理者: ${a.adminName ?? `ID:${a.adminId}`}`}
                    badges={
                      <Badge bg={ACTION_COLORS[a.action] ?? 'secondary'}>
                        {ACTION_LABELS[a.action] ?? a.action}
                      </Badge>
                    }
                    fields={[
                      { label: 'ステータス', value: `${a.previousStatus ?? '—'} → ${a.newStatus}` },
                      { label: '理由', value: a.reason ?? '—' },
                      { label: '日時', value: formatDateTimeJa(a.createdAt) },
                    ]}
                  />
                ))}
              </div>
            )}
          />
        )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
