import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, Col, Form, Row } from 'react-bootstrap';
import { api, buildApiUrl } from '../api/client';
import Pagination from '../components/Pagination';
import InlineLoader from '../components/ui/InlineLoader';
import AppTable from '../components/ui/AppTable';
import AppEmptyState from '../components/ui/AppEmptyState';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import SavedViewsPanel from '../components/ui/SavedViewsPanel';
import WorkContextBar from '../components/ui/WorkContextBar';
import { useSavedViews } from '../hooks/useSavedViews';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useTrackRecentWork } from '../hooks/useRecentWork';
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
  rowDataJson?: unknown;
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
const UPLOAD_QUALITY_SAVED_VIEWS_KEY = 'upload-quality:saved-views';

interface UploadQualitySavedFilters {
  issueCodeFilter: string;
}

const DEFAULT_ISSUE_REMEDIATION: Record<string, { cause: string; fix: string; verify: string }> = {
  MISSING_EXPIRY: {
    cause: '使用期限列が空か、Excel 内で日付として解釈できていません。',
    fix: '対象行の使用期限を YYYY-MM-DD 形式または Excel の日付セルで埋めて再アップロードしてください。',
    verify: '再取込前に raw row を確認し、期限セルに値が入っていることを確認します。',
  },
  INVALID_PRICE: {
    cause: '薬価列に文字列や記号が含まれており、数値化に失敗しています。',
    fix: '薬価列を半角数字のみへ修正し、通貨記号やカンマを除去してください。',
    verify: 'CSV 出力した問題行で price 列が数値だけになっているか確認します。',
  },
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [remediations, setRemediations] = useState(DEFAULT_ISSUE_REMEDIATION);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const requestedIssueCodeFilter = searchParams.get('issueCode') ?? '';
  const [issueCodeFilter, setIssueCodeFilter] = useState(requestedIssueCodeFilter);
  const { savedViews, createSavedView, deleteSavedView } = useSavedViews<UploadQualitySavedFilters>(UPLOAD_QUALITY_SAVED_VIEWS_KEY);

  useEffect(() => {
    setSummaryLoading(true);
    setSummaryError('');
    void api.get<QualitySummary>('/upload-quality/my-summary')
      .then((nextSummary) => setSummary(nextSummary))
      .catch((err) => {
        setSummaryError(err instanceof Error ? err.message : 'アップロード品質サマリーの取得に失敗しました');
      })
      .finally(() => setSummaryLoading(false));
    void api.get<{ data: typeof DEFAULT_ISSUE_REMEDIATION }>('/upload-quality/remediations')
      .then((res) => setRemediations(res.data))
      .catch(() => setRemediations(DEFAULT_ISSUE_REMEDIATION));
  }, []);

  useEffect(() => {
    setIssueCodeFilter((current) => (current === requestedIssueCodeFilter ? current : requestedIssueCodeFilter));
  }, [requestedIssueCodeFilter]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (issueCodeFilter) {
      nextParams.set('issueCode', issueCodeFilter);
    } else {
      nextParams.delete('issueCode');
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [issueCodeFilter, searchParams, setSearchParams]);

  const getIssueRemediation = useCallback((issueCode: string): { cause: string; fix: string; verify: string } | null => (
    remediations[issueCode] ?? DEFAULT_ISSUE_REMEDIATION[issueCode] ?? null
  ), [remediations]);

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
  const dominantIssueCode = summary?.issuesByCode[0]?.issueCode ?? '';
  const dominantUploadType = items[0]?.uploadType ?? 'dead_stock';
  const reuploadPath = `/upload?reuseSavedMapping=1&uploadType=${dominantUploadType}${dominantIssueCode ? `&issueCode=${encodeURIComponent(dominantIssueCode)}` : ''}`;
  const groupedVisibleIssues = useMemo(() => {
    const groups = new Map<string, UploadQualityIssue[]>();
    for (const issue of items) {
      const current = groups.get(issue.issueCode) ?? [];
      current.push(issue);
      groups.set(issue.issueCode, current);
    }
    return [...groups.entries()]
      .map(([issueCode, groupedItems]) => ({ issueCode, items: groupedItems }))
      .sort((left, right) => right.items.length - left.items.length || left.issueCode.localeCompare(right.issueCode));
  }, [items]);
  const nextStepLinks = hasIssues
    ? [
      { to: reuploadPath, label: '保存済み設定で再アップロード', variant: 'outline-primary' },
      { to: '/inventory/dead-stock', label: 'デッドストックを見る', variant: 'outline-secondary' },
      { to: '/inventory/used-medication', label: '使用量リストを見る', variant: 'outline-secondary' },
      { to: '/statistics', label: '統計を見る', variant: 'outline-secondary' },
    ]
    : [
      { to: '/upload', label: 'アップロードへ戻る', variant: 'outline-primary' },
      { to: '/inventory/dead-stock', label: 'デッドストックを見る', variant: 'outline-secondary' },
      { to: '/inventory/used-medication', label: '使用量リストを見る', variant: 'outline-secondary' },
    ];

  useTrackRecentWork(useMemo(() => ({
    id: `upload-quality${issueCodeFilter ? `-${issueCodeFilter}` : ''}`,
    label: issueCodeFilter ? `アップロード品質 / ${issueCodeFilter}` : 'アップロード品質',
    to: `/upload-quality${issueCodeFilter ? `?issueCode=${encodeURIComponent(issueCodeFilter)}` : ''}`,
    section: 'アップロード品質',
    subtitle: hasIssues ? `${summary?.totalIssues ?? 0} 件の問題` : '問題なし',
  }), [hasIssues, issueCodeFilter, summary?.totalIssues]));

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

      <WorkContextBar
        title="アップロード修正ワークベンチ"
        currentLabel={issueCodeFilter ? `現在の issue: ${issueCodeFilter}` : '現在の issue: すべて'}
        description="問題行の確認、CSV 出力、保存済みマッピングでの再取込までをここから進めます。"
        backTo="/upload"
        backLabel="アップロード画面へ"
        badges={[
          { label: hasIssues ? `問題 ${summary?.totalIssues ?? 0} 件` : '問題なし', bg: hasIssues ? 'warning' : 'success', text: hasIssues ? 'dark' : 'light' },
          dominantIssueCode ? { label: `最多: ${dominantIssueCode}`, bg: 'secondary' } : null,
        ]}
        nextActions={[
          { to: reuploadPath, label: '再アップロード', variant: 'outline-primary' },
          { to: '/inventory/dead-stock', label: 'デッドストック', variant: 'outline-secondary' },
          { to: '/inventory/used-medication', label: '使用量リスト', variant: 'outline-secondary' },
        ]}
      />

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
            {hasIssues
              ? '問題行を確認したら、保存済みマッピングを使って再アップロードし、在庫画面で反映状況を確認します。'
              : '問題がなければ在庫画面へ戻って結果を確認します。'}
          </span>
        </Card.Body>
      </Card>
      <SavedViewsPanel
        description="エラーコード別の見方を保存できます。"
        shareUrl={typeof window !== 'undefined' ? window.location.href : null}
        savedViews={savedViews}
        presets={[
          {
            key: 'upload-all',
            name: '全問題',
            description: 'すべてのエラーコードを表示します。',
            filters: { issueCodeFilter: '' },
          },
          ...(dominantIssueCode
            ? [{
                key: `upload-dominant-${dominantIssueCode}`,
                name: `最多: ${dominantIssueCode}`,
                description: '件数が多い issue を優先表示します。',
                filters: { issueCodeFilter: dominantIssueCode },
              }]
            : []),
        ]}
        onSave={() => {
          const name = window.prompt('保存ビュー名を入力してください');
          if (!name) return;
          createSavedView(name, { issueCodeFilter });
        }}
        onApply={(filters) => {
          setIssueCodeFilter(filters.issueCodeFilter);
          setPage(1);
        }}
        onDelete={deleteSavedView}
      />

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
                <Card.Header className="py-2 d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <span>エラーコード別</span>
                  {hasIssues && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => {
                        const params = new URLSearchParams();
                        if (issueCodeFilter) params.set('issueCode', issueCodeFilter);
                        window.open(buildApiUrl(`/upload-quality/my-issues/export.csv?${params.toString()}`), '_blank', 'noopener');
                      }}
                    >
                      問題行をCSV出力
                    </button>
                  )}
                </Card.Header>
                <Card.Body className="p-2 d-flex flex-wrap gap-2">
                  {summary.issuesByCode.length > 0 ? summary.issuesByCode.map((issue) => (
                    <button
                      key={issue.issueCode}
                      type="button"
                      className={`btn btn-sm ${issueCodeFilter === issue.issueCode ? 'btn-secondary' : 'btn-outline-secondary'}`}
                      onClick={() => {
                        setIssueCodeFilter((current) => (current === issue.issueCode ? '' : issue.issueCode));
                        setPage(1);
                      }}
                    >
                      {issue.issueCode}: {issue.count}
                    </button>
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
          {hasIssues && (
            <Col xs={12} md={8} className="d-flex align-items-center gap-2 flex-wrap">
              <Link to={reuploadPath} className="btn btn-outline-primary btn-sm">
                保存済み設定で再アップロード
              </Link>
              <span className="small text-muted">
                過去プレビューで保存された列マッピングを再利用しながら修正できます。
              </span>
            </Col>
          )}
        </Row>

        {!loading && groupedVisibleIssues.length > 0 && (
          <Card className="mb-3">
            <Card.Header>エラータイプごとの確認</Card.Header>
            <Card.Body className="d-flex flex-column gap-2">
              {groupedVisibleIssues.map((group) => {
                const firstIssue = group.items[0];
                return (
                  <div key={`group-${group.issueCode}`} className="border rounded p-3">
                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                      <div>
                        <div className="fw-semibold">{group.issueCode}</div>
                        <div className="small text-muted">
                          {group.items.length} 件 / 最新メッセージ: {firstIssue?.issueMessage ?? '-'}
                        </div>
                        {getIssueRemediation(group.issueCode) && (
                          <div className="small text-muted mt-2">
                            原因: {getIssueRemediation(group.issueCode)?.cause}
                          </div>
                        )}
                      </div>
                      <div className="d-flex gap-2 flex-wrap">
                        <button
                          type="button"
                          className={`btn btn-sm ${issueCodeFilter === group.issueCode ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => {
                            setIssueCodeFilter(group.issueCode);
                            setPage(1);
                          }}
                        >
                          このタイプだけ見る
                        </button>
                        <Link
                          to={`/upload?reuseSavedMapping=1&uploadType=${firstIssue?.uploadType ?? 'dead_stock'}&issueCode=${encodeURIComponent(group.issueCode)}`}
                          className="btn btn-sm btn-outline-primary"
                        >
                          このエラーで再アップロード
                        </Link>
                      </div>
                    </div>
                    {getIssueRemediation(group.issueCode) && (
                      <div className="small mt-3">
                        <div><strong>修正方法:</strong> {getIssueRemediation(group.issueCode)?.fix}</div>
                        <div className="text-muted mt-1"><strong>再確認:</strong> {getIssueRemediation(group.issueCode)?.verify}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </Card.Body>
          </Card>
        )}

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
                        <th>元データ</th>
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
                          <td className="small">
                            <code>{issue.rowDataJson ? JSON.stringify(issue.rowDataJson).slice(0, 160) : '-'}</code>
                          </td>
                          <td>
                            <div className="d-flex gap-2 flex-wrap">
                              <Link
                                to={`/upload?reuseSavedMapping=1&uploadType=${issue.uploadType}&issueCode=${encodeURIComponent(issue.issueCode)}&jobId=${issue.jobId}`}
                                className="btn btn-outline-primary btn-sm"
                              >
                                保存設定で再取込
                              </Link>
                              <Link to={resolveIssueDestination(issue.uploadType)} className="btn btn-outline-secondary btn-sm">
                                {resolveIssueDestinationLabel(issue.uploadType)}
                              </Link>
                            </div>
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
                        { label: '元データ', value: issue.rowDataJson ? JSON.stringify(issue.rowDataJson).slice(0, 120) : '-' },
                        { label: '修正', value: getIssueRemediation(issue.issueCode)?.fix ?? '保存済み設定で再取込し、raw row を確認してください。' },
                      ]}
                      actions={(
                        <div className="d-flex gap-2 flex-wrap">
                          <Link
                            to={`/upload?reuseSavedMapping=1&uploadType=${issue.uploadType}&issueCode=${encodeURIComponent(issue.issueCode)}&jobId=${issue.jobId}`}
                            className="btn btn-outline-primary btn-sm"
                          >
                            保存設定で再取込
                          </Link>
                          <Link to={resolveIssueDestination(issue.uploadType)} className="btn btn-outline-secondary btn-sm">
                            {resolveIssueDestinationLabel(issue.uploadType)}
                          </Link>
                        </div>
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
