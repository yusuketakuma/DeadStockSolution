import { FormEvent, useMemo, useState } from 'react';
import AppAlert from '../../components/ui/AppAlert';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import LoadingButton from '../../components/ui/LoadingButton';
import AppField from '../../components/ui/AppField';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import InlineLoader from '../../components/ui/InlineLoader';
import Pagination from '../../components/Pagination';
import { api, buildApiUrl } from '../../api/client';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface MonthlyReportListItem {
  id: number;
  year: number;
  month: number;
  status: 'success' | 'failed';
  generatedBy: number | null;
  generatedAt: string | null;
}

interface MonthlyReportsResponse {
  data: MonthlyReportListItem[];
  pagination: { page: number; totalPages: number; total: number };
}

function defaultTargetMonth(): { year: number; month: number } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}

export default function AdminMonthlyReportsPage() {
  const defaultTarget = useMemo(() => defaultTargetMonth(), []);
  const [year, setYear] = useState(String(defaultTarget.year));
  const [month, setMonth] = useState(String(defaultTarget.month));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const {
    items: rows,
    page,
    setPage,
    totalPages,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<MonthlyReportListItem, MonthlyReportsResponse>((targetPage, signal) =>
    api.get<MonthlyReportsResponse>(`/admin/reports/monthly?page=${targetPage}`, { signal }),
    { errorMessage: '月次レポート一覧の取得に失敗しました' },
  );

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');
    setActionError('');
    try {
      const result = await api.post<{ message: string }>('/admin/reports/monthly/generate', {
        year: Number(year),
        month: Number(month),
      });
      setMessage(result.message);
      if (page !== 1) {
        setPage(1);
      } else {
        await fetchPage(1);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '月次レポート生成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">月次レポート</h4>
      {message && <AppAlert variant="success">{message}</AppAlert>}
      {actionError && <AppAlert variant="danger">{actionError}</AppAlert>}
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}

      <form onSubmit={handleGenerate} className="mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-md-3">
            <AppField
              controlId="monthly-report-year"
              label="年"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={setYear}
              required
            />
          </div>
          <div className="col-md-3">
            <AppField
              controlId="monthly-report-month"
              label="月"
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={setMonth}
              required
            />
          </div>
          <div className="col-md-3">
            <LoadingButton type="submit" loading={submitting} loadingLabel="生成中...">
              月次レポートを生成
            </LoadingButton>
          </div>
        </div>
      </form>

      <ScrollArea>
      {loading ? (
        <InlineLoader text="月次レポート一覧を読み込み中..." className="text-muted small" />
      ) : rows.length === 0 ? (
        <AppEmptyState title="レポートがありません" description="生成するとここに表示されます。" />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover className="mobile-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>対象月</th>
                    <th>状態</th>
                    <th>生成日時</th>
                    <th>DL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td>{row.year}/{String(row.month).padStart(2, '0')}</td>
                      <td>{row.status === 'success' ? '成功' : '失敗'}</td>
                      <td>{formatDateTimeJa(row.generatedAt)}</td>
                      <td className="d-flex gap-2">
                        <a className="btn btn-sm btn-outline-primary" href={buildApiUrl(`/admin/reports/monthly/${row.id}/download?format=json`)}>JSON</a>
                        <a className="btn btn-sm btn-outline-secondary" href={buildApiUrl(`/admin/reports/monthly/${row.id}/download?format=csv`)}>CSV</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {rows.map((row) => (
                <AppMobileDataCard
                  key={row.id}
                  title={`${row.year}/${String(row.month).padStart(2, '0')}`}
                  subtitle={`ID: ${row.id}`}
                  fields={[
                    { label: '状態', value: row.status === 'success' ? '成功' : '失敗' },
                    { label: '生成日時', value: formatDateTimeJa(row.generatedAt) },
                  ]}
                  actions={(
                    <div className="d-flex gap-2">
                      <a className="btn btn-sm btn-outline-primary" href={buildApiUrl(`/admin/reports/monthly/${row.id}/download?format=json`)}>JSON</a>
                      <a className="btn btn-sm btn-outline-secondary" href={buildApiUrl(`/admin/reports/monthly/${row.id}/download?format=csv`)}>CSV</a>
                    </div>
                  )}
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
