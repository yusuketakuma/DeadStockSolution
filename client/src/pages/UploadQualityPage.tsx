import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import InlineLoader from '../components/ui/InlineLoader';
import AppTable from '../components/ui/AppTable';
import AppEmptyState from '../components/ui/AppEmptyState';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { resolveUploadTypeLabel, type UploadType } from './upload/upload-job-utils';
import { formatCountJa, formatDateTimeJa } from '../utils/formatters';

interface QualitySummary {
  totalIssues: number;
  issuesByCode: Array<{
    issueCode: string;
    count: number;
  }>;
}

interface UploadQualityIssue {
  id: number;
  jobId: number;
  uploadType: UploadType;
  rowNumber: number;
  issueCode: string;
  issueMessage: string;
  createdAt: string | null;
}

interface UploadQualityIssuesPayload {
  issues: UploadQualityIssue[];
  total: number;
  page: number;
  limit: number;
}

interface UploadQualityIssuesResponse {
  data: UploadQualityIssue[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function resolveIssueDestination(uploadType: UploadType): string {
  return uploadType === 'used_medication' ? '/inventory/used-medication' : '/inventory/dead-stock';
}

function resolveIssueDestinationLabel(uploadType: UploadType): string {
  return uploadType === 'used_medication' ? '使用量リストへ' : 'デッドストックへ';
}

function normalizeIssuesPayload(payload: UploadQualityIssuesPayload): UploadQualityIssuesResponse {
  const totalPages = Math.max(1, Math.ceil(payload.total / Math.max(payload.limit, 1)));
  return {
    data: payload.issues,
    pagination: {
      page: payload.page,
      limit: payload.limit,
      total: payload.total,
      totalPages,
    },
  };
}

export default function UploadQualityPage() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [issueCodeFilter, setIssueCodeFilter] = useState('');

  useEffect(() => {
    setSummaryLoading(true);
    setSummaryError('');
    void api.get<QualitySummary>('/upload-quality/my-summary')
      .then((nextSummary) => setSummary(nextSummary))
      .catch((err) => {
        setSummaryError(err instanceof Error ? err.message : 'アップロード品質サマリーの取得に失敗しました');
      })
      .finally(() => setSummaryLoading(false));
  }, []);

  const fetchIssues = useCallback(async (targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      page: String(targetPage),
      limit: '20',
    });
    if (issueCodeFilter) {
      params.set('issueCode', issueCodeFilter);
    }
    const payload = await api.get<UploadQualityIssuesPayload>(`/upload-quality/my-issues?${params}`, { signal });
    return normalizeIssuesPayload(payload);
  }, [issueCodeFilter]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<UploadQualityIssue, UploadQualityIssuesResponse>(
    fetchIssues,
    { errorMessage: 'アップロード問題一覧の取得に失敗しました' },
  );

  const hasIssues = (summary?.totalIssues ?? 0) > 0;
  const combinedError = summaryError || error;
  const nextStepLinks = hasIssues
    ? [
      { to: '/upload', label: '再アップロードする', variant: 'outline-primary' },
      { to: '/inventory/dead-stock', label: 'デッドストックを見る', variant: 'outline-secondary' },
      { to: '/inventory/used-medication', label: '使用量リストを見る', variant: 'outline-secondary' },
      { to: '/statistics', label: '統計を見る', variant: 'outline-secondary' },
    ]
    : [
      { to: '/upload', label: 'アップロードへ戻る', variant: 'outline-primary' },
      { to: '/inventory/dead-stock', label: 'デッドストックを見る', variant: 'outline-secondary' },
      { to: '/inventory/used-medication', label: '使用量リストを見る', variant: 'outline-secondary' },
    ];

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">アップロード品質</h4>
          <small className="text-muted">最近のアップロードで検出された問題を確認できます。</small>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
          <Link to="/inventory/dead-stock" className="btn btn-outline-secondary btn-sm">デッドストック</Link>
          <Link to="/inventory/used-medication" className="btn btn-outline-secondary btn-sm">使用量リスト</Link>
          <Link to="/statistics" className="btn btn-outline-secondary btn-sm">統計</Link>
        </div>
      </div>

      {combinedError && (
        <ErrorRetryAlert
          error={combinedError}
          onRetry={() => {
            if (summaryError) {
              setSummaryLoading(true);
              setSummaryError('');
              void api.get<QualitySummary>('/upload-quality/my-summary')
                .then((nextSummary) => setSummary(nextSummary))
                .catch((err) => {
                  setSummaryError(err instanceof Error ? err.message : 'アップロード品質サマリーの取得に失敗しました');
                })
                .finally(() => setSummaryLoading(false));
            }
            void retry();
          }}
        />
      )}

      <Card className="mb-3">
        <Card.Header>次にやること</Card.Header>
        <Card.Body className="d-flex gap-2 flex-wrap align-items-center">
          {nextStepLinks.map((link) => (
            <Link key={link.to} to={link.to} className={`btn btn-sm btn-${link.variant}`}>
              {link.label}
            </Link>
          ))}
          <span className="small text-muted">
            {hasIssues ? '問題行を確認したら再アップロードし、在庫画面で反映状況を確認します。' : '問題がなければ在庫画面へ戻って結果を確認します。'}
          </span>
        </Card.Body>
      </Card>

      <ScrollArea>
        {summaryLoading ? (
          <InlineLoader text="アップロード品質を読み込み中..." className="text-muted small mb-3" />
        ) : summary && (
          <Row className="mb-3 g-2">
            <Col xs={12} md={4}>
              <Card body className="text-center">
                <div className="small text-muted">問題総数</div>
                <div className={`fs-4 fw-bold${hasIssues ? ' text-danger' : ' text-success'}`}>
                  {formatCountJa(summary.totalIssues)}
                </div>
              </Card>
            </Col>
            <Col xs={12} md={8}>
              <Card>
                <Card.Header className="py-2">エラーコード別</Card.Header>
                <Card.Body className="p-2 d-flex flex-wrap gap-2">
                  {summary.issuesByCode.length > 0 ? summary.issuesByCode.map((issue) => (
                    <Badge key={issue.issueCode} bg="secondary">
                      {issue.issueCode}: {issue.count}
                    </Badge>
                  )) : (
                    <span className="small text-muted">現在、問題は検出されていません。</span>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        )}

        <Row className="mb-3 g-2">
          <Col xs={12} md={4}>
            <Form.Select
              size="sm"
              value={issueCodeFilter}
              onChange={(event) => {
                setIssueCodeFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">すべてのエラーコード</option>
              {summary?.issuesByCode.map((issue) => (
                <option key={issue.issueCode} value={issue.issueCode}>
                  {issue.issueCode} ({issue.count})
                </option>
              ))}
            </Form.Select>
          </Col>
        </Row>

        {!loading && !hasIssues && !issueCodeFilter ? (
          <AppEmptyState
            title="アップロード問題はありません"
            description="新しいアップロードで問題が発生した場合にここへ表示されます。"
            actionLabel="アップロードへ進む"
            actionTo="/upload"
          />
        ) : loading ? (
          <InlineLoader text="問題一覧を読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState
            title="該当する問題がありません"
            description="フィルタ条件を変更すると別の問題を確認できます。"
            actionLabel="アップロードへ戻る"
            actionTo="/upload"
          />
        ) : (
          <>
            <AppResponsiveSwitch
              desktop={() => (
                <div className="table-responsive">
                  <AppTable striped hover className="mobile-table">
                    <thead className="table-light">
                      <tr>
                        <th>ジョブID</th>
                        <th>取込種別</th>
                        <th>行番号</th>
                        <th>エラーコード</th>
                        <th>メッセージ</th>
                        <th>検出日時</th>
                        <th>関連画面</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((issue) => (
                        <tr key={issue.id}>
                          <td>{issue.jobId}</td>
                          <td>{resolveUploadTypeLabel(issue.uploadType)}</td>
                          <td>{issue.rowNumber}</td>
                          <td><code>{issue.issueCode}</code></td>
                          <td className="small">{issue.issueMessage}</td>
                          <td className="small">{formatDateTimeJa(issue.createdAt)}</td>
                          <td>
                            <Link to={resolveIssueDestination(issue.uploadType)} className="btn btn-outline-secondary btn-sm">
                              {resolveIssueDestinationLabel(issue.uploadType)}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AppTable>
                </div>
              )}
              mobile={() => (
                <div className="dl-mobile-data-list">
                  {items.map((issue) => (
                    <AppMobileDataCard
                      key={issue.id}
                      title={`${resolveUploadTypeLabel(issue.uploadType)} / 行${issue.rowNumber}`}
                      subtitle={`ジョブID: ${issue.jobId}`}
                      badges={<Badge bg="danger">{issue.issueCode}</Badge>}
                      fields={[
                        { label: 'メッセージ', value: issue.issueMessage },
                        { label: '検出日時', value: formatDateTimeJa(issue.createdAt) },
                      ]}
                      actions={(
                        <Link to={resolveIssueDestination(issue.uploadType)} className="btn btn-outline-secondary btn-sm">
                          {resolveIssueDestinationLabel(issue.uploadType)}
                        </Link>
                      )}
                    />
                  ))}
                </div>
              )}
            />
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </ScrollArea>
    </PageShell>
  );
}
