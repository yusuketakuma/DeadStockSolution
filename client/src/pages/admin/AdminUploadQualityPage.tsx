import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface QualitySummary {
  totalIssues: number;
  issuesByCode: { issueCode: string; count: number }[];
  issuesByPharmacy: { pharmacyId: number; pharmacyName: string | null; issueCount: number }[];
}

interface IssueItem {
  id: number;
  jobId: number;
  pharmacyId: number;
  pharmacyName: string | null;
  uploadType: string;
  rowNumber: number;
  issueCode: string;
  issueMessage: string;
  createdAt: string | null;
}

interface IssuesResponse {
  data: IssueItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function AdminUploadQualityPage() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [codeFilter, setCodeFilter] = useState('');

  useEffect(() => {
    setSummaryLoading(true);
    void api.get<{ data: QualitySummary }>('/admin/upload-quality/summary')
      .then((res) => setSummary(res.data))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, []);

  const fetcher = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (codeFilter) params.set('issueCode', codeFilter);
    return api.get<IssuesResponse>(`/admin/upload-quality/issues?${params}`, { signal });
  }, [codeFilter]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<IssueItem, IssuesResponse>(
    fetcher,
    { errorMessage: 'アップロード問題の取得に失敗しました' },
  );

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">アップロード品質</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/upload-jobs" className="btn btn-outline-secondary btn-sm">取込ジョブ管理</Link>
        </div>
      </div>

      <ScrollArea>
        {summaryLoading ? (
          <InlineLoader text="サマリーを読み込み中..." className="text-muted small mb-3" />
        ) : summary && (
          <Row className="mb-3 g-2">
            <Col xs={12} md={4}>
              <Card body className="text-center">
                <div className="small text-muted">問題総数</div>
                <div className="fs-4 fw-bold text-danger">{summary.totalIssues}</div>
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card>
                <Card.Header className="py-2">エラーコード別</Card.Header>
                <Card.Body className="p-2">
                  {summary.issuesByCode.slice(0, 5).map((c) => (
                    <div key={c.issueCode} className="d-flex justify-content-between small">
                      <code>{c.issueCode}</code>
                      <Badge bg="secondary">{c.count}</Badge>
                    </div>
                  ))}
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card>
                <Card.Header className="py-2">薬局別エラー上位</Card.Header>
                <Card.Body className="p-2">
                  {summary.issuesByPharmacy.slice(0, 5).map((p) => (
                    <div key={p.pharmacyId} className="d-flex justify-content-between small">
                      <span>{p.pharmacyName ?? `ID:${p.pharmacyId}`}</span>
                      <Badge bg="warning">{p.issueCount}</Badge>
                    </div>
                  ))}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        )}

        <Row className="mb-3 g-2">
          <Col xs={12} md={4}>
            <Form.Select size="sm" value={codeFilter} onChange={(e) => { setCodeFilter(e.target.value); setPage(1); }}>
              <option value="">すべてのエラーコード</option>
              {summary?.issuesByCode.map((c) => (
                <option key={c.issueCode} value={c.issueCode}>{c.issueCode} ({c.count})</option>
              ))}
            </Form.Select>
          </Col>
        </Row>

        {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

        {loading ? (
          <InlineLoader text="問題一覧を読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState title="アップロード問題がありません" description="アップロード時の問題が検出されるとここに表示されます。" />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>薬局</th>
                      <th>ジョブID</th>
                      <th>行番号</th>
                      <th>エラーコード</th>
                      <th>メッセージ</th>
                      <th>日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.id}</td>
                        <td>{i.pharmacyName ?? `ID:${i.pharmacyId}`}</td>
                        <td>{i.jobId}</td>
                        <td>{i.rowNumber}</td>
                        <td><code>{i.issueCode}</code></td>
                        <td className="small">{i.issueMessage}</td>
                        <td className="small">{formatDateTimeJa(i.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((i) => (
                  <AppMobileDataCard
                    key={i.id}
                    title={`行${i.rowNumber}: ${i.issueCode}`}
                    subtitle={i.pharmacyName ?? `薬局ID:${i.pharmacyId}`}
                    badges={<Badge bg="danger">{i.issueCode}</Badge>}
                    fields={[
                      { label: 'メッセージ', value: i.issueMessage },
                      { label: 'ジョブID', value: String(i.jobId) },
                      { label: '日時', value: formatDateTimeJa(i.createdAt) },
                    ]}
                  />
                ))}
              </div>
            )}
          />
        )}
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </ScrollArea>
    </PageShell>
  );
}
