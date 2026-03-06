import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Badge, Col, Row } from 'react-bootstrap';
import { api, buildApiUrl } from '../../api/client';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AppSelect from '../../components/ui/AppSelect';
import AppTable from '../../components/ui/AppTable';
import InlineLoader from '../../components/ui/InlineLoader';
import Pagination from '../../components/Pagination';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import {
  type DiffSummary,
  type PartialSummary,
  type UploadApplyMode,
  type UploadJobStatus,
  type UploadType,
  resolvePartialSummaryEntries,
  resolveUploadApplyModeLabel,
  resolveUploadJobStatusLabel,
  resolveUploadTypeLabel,
} from '../upload/upload-job-utils';
import { formatCountJa, formatDateTimeJa, formatNumberJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface UploadJobRow {
  id: number;
  pharmacyId: number | null;
  pharmacyName: string | null;
  uploadType: UploadType;
  applyMode: UploadApplyMode;
  deleteMissing: boolean;
  originalFilename: string;
  status: UploadJobStatus;
  attempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  rowCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  partialSummary?: PartialSummary | null;
  diffSummary?: DiffSummary | null;
  errorReportAvailable?: boolean;
  deduplicated?: boolean;
  cancelable?: boolean;
  retryable?: boolean;
}

interface UploadJobsResponse {
  data: UploadJobRow[];
  pagination: {
    page: number;
    totalPages: number;
    total: number;
  };
}

interface UploadJobDetailResponse {
  data: UploadJobRow;
}

type JobStatusFilter = 'all' | UploadJobStatus;
type UploadTypeFilter = 'all' | UploadType;

function resolveStatusBadgeVariant(status: UploadJobStatus): 'secondary' | 'warning' | 'primary' | 'success' | 'danger' | 'dark' {
  if (status === 'pending') return 'secondary';
  if (status === 'processing') return 'primary';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled' || status === 'canceled') return 'dark';
  return 'secondary';
}

function normalizeDetailResponse(payload: UploadJobRow | UploadJobDetailResponse): UploadJobRow {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export default function AdminUploadJobsPage() {
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>('all');
  const [uploadTypeFilter, setUploadTypeFilter] = useState<UploadTypeFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState<UploadJobRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionKey, setActionKey] = useState<string | null>(null);
  const initializedFilterRef = useRef(false);
  const normalizedKeyword = useMemo(() => keyword.trim(), [keyword]);

  const fetchJobs = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      page: String(targetPage),
      limit: '30',
    });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (uploadTypeFilter !== 'all') params.set('uploadType', uploadTypeFilter);
    if (normalizedKeyword) params.set('keyword', normalizedKeyword);
    return api.get<UploadJobsResponse>(`/admin/upload-jobs?${params.toString()}`, { signal });
  }, [normalizedKeyword, statusFilter, uploadTypeFilter]);

  const {
    items: jobs,
    page,
    setPage,
    pagination,
    totalPages,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<UploadJobRow, UploadJobsResponse>(fetchJobs, {
    errorMessage: 'アップロードジョブ一覧の取得に失敗しました',
  });

  const fetchJobDetail = useCallback(async (jobId: number) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const detail = await api.get<UploadJobRow | UploadJobDetailResponse>(`/admin/upload-jobs/${jobId}`);
      setSelectedJob(normalizeDetailResponse(detail));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'ジョブ詳細の取得に失敗しました');
      setSelectedJob(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initializedFilterRef.current) {
      initializedFilterRef.current = true;
      return;
    }
    if (page !== 1) {
      setPage(1);
      return;
    }
    void fetchPage(1);
  }, [fetchPage, keyword, page, setPage, statusFilter, uploadTypeFilter]);

  const openJobDetail = (jobId: number) => {
    setSelectedJobId(jobId);
    void fetchJobDetail(jobId);
  };

  const closeJobDetail = () => {
    setSelectedJobId(null);
    setSelectedJob(null);
    setDetailError('');
  };

  const handleRetryList = () => {
    void retry();
    if (selectedJobId !== null) {
      void fetchJobDetail(selectedJobId);
    }
  };

  const runJobAction = async (jobId: number, action: 'retry' | 'cancel') => {
    const key = `${action}:${jobId}`;
    setActionKey(key);
    setActionError('');
    setMessage('');
    try {
      const result = action === 'cancel'
        ? await api.patch<{ message?: string }>(`/admin/upload-jobs/${jobId}/cancel`)
        : await api.post<{ message?: string }>(`/admin/upload-jobs/${jobId}/retry`);
      setMessage(result.message ?? (action === 'retry' ? 'ジョブを再実行しました' : 'ジョブをキャンセルしました'));
      await Promise.all([
        fetchPage(page),
        selectedJobId === jobId ? fetchJobDetail(jobId) : Promise.resolve(),
      ]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ジョブ操作に失敗しました');
    } finally {
      setActionKey(null);
    }
  };

  const triggerErrorReportDownload = (jobId: number) => {
    const reportUrl = buildApiUrl(`/admin/upload-jobs/${jobId}/error-report`);
    window.open(reportUrl, '_blank', 'noopener');
  };

  const selectedSummary: PartialSummary | null = selectedJob?.partialSummary
    ?? (selectedJob?.diffSummary ? { ...selectedJob.diffSummary } : null);
  const selectedPartialSummaryEntries = resolvePartialSummaryEntries(
    selectedSummary,
  );

  return (
    <PageShell>
      <h4 className="page-title mb-3">アップロードジョブ管理 ({formatCountJa(pagination?.total ?? 0)})</h4>

      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {actionError && <AppAlert variant="danger" onClose={() => setActionError('')} dismissible>{actionError}</AppAlert>}
      {error && (
        <ErrorRetryAlert error={error} onRetry={handleRetryList} />
      )}

      <Row className="g-2 mb-3">
        <Col md={3}>
          <AppSelect
            value={statusFilter}
            ariaLabel="ステータスで絞り込み"
            onChange={(value) => {
              setStatusFilter(value as JobStatusFilter);
              setPage(1);
            }}
            options={[
              { value: 'all', label: '全ステータス' },
              { value: 'pending', label: '待機中' },
              { value: 'processing', label: '処理中' },
              { value: 'completed', label: '完了' },
              { value: 'failed', label: '失敗' },
              { value: 'canceled', label: 'キャンセル' },
            ]}
          />
        </Col>
        <Col md={3}>
          <AppSelect
            value={uploadTypeFilter}
            ariaLabel="取込種別で絞り込み"
            onChange={(value) => {
              setUploadTypeFilter(value as UploadTypeFilter);
              setPage(1);
            }}
            options={[
              { value: 'all', label: '全取込種別' },
              { value: 'dead_stock', label: 'デッドストック' },
              { value: 'used_medication', label: '使用量' },
            ]}
          />
        </Col>
        <Col md={6}>
          <AppControl
            aria-label="アップロードジョブ検索"
            placeholder="ファイル名・薬局名・エラー内容で検索"
            value={keyword}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </Col>
      </Row>

      <ScrollArea>
      {loading ? (
        <InlineLoader text="アップロードジョブを読み込み中..." className="text-muted small mb-3" />
      ) : jobs.length === 0 ? (
        <AppEmptyState title="アップロードジョブがありません" description="条件を変えて再確認してください。" />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover className="mobile-table">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>薬局</th>
                    <th>取込種別</th>
                    <th>反映方式</th>
                    <th>状態</th>
                    <th>件数</th>
                    <th>作成日時</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.id}</td>
                      <td>{job.pharmacyName ? `${job.pharmacyName} (ID:${job.pharmacyId ?? '-'})` : `ID:${job.pharmacyId ?? '-'}`}</td>
                      <td>{resolveUploadTypeLabel(job.uploadType)}</td>
                      <td>{resolveUploadApplyModeLabel(job.applyMode)}</td>
                      <td>
                        <Badge bg={resolveStatusBadgeVariant(job.status)}>
                          {resolveUploadJobStatusLabel(job.status)}
                        </Badge>
                        {job.deduplicated && <Badge bg="info" className="ms-1">重複抑止</Badge>}
                      </td>
                      <td>{job.rowCount === null ? '-' : formatCountJa(job.rowCount)}</td>
                      <td>{formatDateTimeJa(job.createdAt)}</td>
                      <td>
                        <AppButton size="sm" variant="outline-primary" onClick={() => openJobDetail(job.id)}>
                          詳細
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {jobs.map((job) => (
                <AppMobileDataCard
                  key={job.id}
                  title={`ジョブID: ${job.id}`}
                  subtitle={job.originalFilename}
                  badges={(
                    <>
                      <Badge bg={resolveStatusBadgeVariant(job.status)}>{resolveUploadJobStatusLabel(job.status)}</Badge>
                      {job.deduplicated && <Badge bg="info">重複抑止</Badge>}
                    </>
                  )}
                  fields={[
                    { label: '薬局', value: job.pharmacyName ? `${job.pharmacyName} (ID:${job.pharmacyId ?? '-'})` : `ID:${job.pharmacyId ?? '-'}` },
                    { label: '取込種別', value: resolveUploadTypeLabel(job.uploadType) },
                    { label: '反映方式', value: resolveUploadApplyModeLabel(job.applyMode) },
                    { label: '反映件数', value: job.rowCount === null ? '-' : formatCountJa(job.rowCount) },
                    { label: '作成日時', value: formatDateTimeJa(job.createdAt) },
                  ]}
                  actions={(
                    <AppButton size="sm" variant="outline-primary" onClick={() => openJobDetail(job.id)}>
                      詳細
                    </AppButton>
                  )}
                />
              ))}
            </div>
          )}
        />
      )}
      </ScrollArea>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      {(selectedJobId !== null || detailLoading || detailError) && (
        <AppCard className="mt-3">
          <AppCard.Header className="d-flex justify-content-between align-items-center">
            <span>ジョブ詳細 {selectedJobId ? `#${selectedJobId}` : ''}</span>
            <AppButton size="sm" variant="outline-secondary" onClick={closeJobDetail}>閉じる</AppButton>
          </AppCard.Header>
          <AppCard.Body>
            {detailLoading ? (
              <InlineLoader text="ジョブ詳細を読み込み中..." className="text-muted small" />
            ) : detailError ? (
              <AppAlert variant="warning" className="mb-0">{detailError}</AppAlert>
            ) : selectedJob ? (
              <>
                <div className="small text-muted mb-2">
                  ファイル: {selectedJob.originalFilename} / 試行回数: {formatNumberJa(selectedJob.attempts)}
                </div>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <AppButton
                    size="sm"
                    variant="outline-primary"
                    disabled={actionKey !== null || !(selectedJob.retryable ?? selectedJob.status === 'failed')}
                    onClick={() => void runJobAction(selectedJob.id, 'retry')}
                  >
                    {actionKey === `retry:${selectedJob.id}` ? '再実行中...' : '再実行'}
                  </AppButton>
                  <AppButton
                    size="sm"
                    variant="outline-warning"
                    disabled={actionKey !== null || !selectedJob.cancelable}
                    onClick={() => void runJobAction(selectedJob.id, 'cancel')}
                  >
                    {actionKey === `cancel:${selectedJob.id}` ? 'キャンセル中...' : 'キャンセル'}
                  </AppButton>
                  <AppButton
                    size="sm"
                    variant="outline-secondary"
                    disabled={!selectedJob.errorReportAvailable}
                    onClick={() => triggerErrorReportDownload(selectedJob.id)}
                  >
                    エラーレポートDL
                  </AppButton>
                </div>
                <Row className="g-3">
                  <Col md={4}>
                    <AppCard body className="h-100">
                      <div className="small text-muted">取込種別</div>
                      <div>{resolveUploadTypeLabel(selectedJob.uploadType)}</div>
                    </AppCard>
                  </Col>
                  <Col md={4}>
                    <AppCard body className="h-100">
                      <div className="small text-muted">反映方式</div>
                      <div>{resolveUploadApplyModeLabel(selectedJob.applyMode)}</div>
                    </AppCard>
                  </Col>
                  <Col md={4}>
                    <AppCard body className="h-100">
                      <div className="small text-muted">反映件数</div>
                      <div>{selectedJob.rowCount === null ? '-' : formatCountJa(selectedJob.rowCount)}</div>
                    </AppCard>
                  </Col>
                </Row>
                {selectedPartialSummaryEntries.length > 0 && (
                  <div className="mt-3">
                    <div className="fw-semibold mb-2">部分サマリー</div>
                    <div className="d-flex flex-wrap gap-2">
                      {selectedPartialSummaryEntries.map((entry) => (
                        <Badge key={entry.key} bg="light" text="dark">
                          {entry.label}: {formatCountJa(entry.value)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {selectedJob.lastError && (
                  <AppAlert variant="danger" className="mt-3 mb-0">
                    {selectedJob.lastErrorCode ? `[${selectedJob.lastErrorCode}] ` : ''}
                    {selectedJob.lastError}
                  </AppAlert>
                )}
                <div className="small text-muted mt-3">
                  作成: {formatDateTimeJa(selectedJob.createdAt)} / 更新: {formatDateTimeJa(selectedJob.updatedAt)} / 完了: {formatDateTimeJa(selectedJob.completedAt)}
                </div>
              </>
            ) : (
              <div className="text-muted small">ジョブを選択してください。</div>
            )}
          </AppCard.Body>
        </AppCard>
      )}
    </PageShell>
  );
}
