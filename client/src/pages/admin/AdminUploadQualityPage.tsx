import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import AppAlert from '../../components/ui/AppAlert';
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

interface UploadIssueRemediationMap {
  [issueCode: string]: {
    cause: string;
    fix: string;
    verify: string;
  };
}

export default function AdminUploadQualityPage() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [codeFilter, setCodeFilter] = useState('');
  const [remediations, setRemediations] = useState<UploadIssueRemediationMap>({});
  const [remediationHistory, setRemediationHistory] = useState<Array<{ id: number; cause: string; fix: string; verify: string; createdAt: string | null }>>([]);
  const [editingCode, setEditingCode] = useState('');
  const [editingRemediation, setEditingRemediation] = useState({ cause: '', fix: '', verify: '' });
  const [savingRemediation, setSavingRemediation] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSummaryLoading(true);
    void api.get<{ data: QualitySummary }>('/admin/upload-quality/summary')
      .then((res) => setSummary(res.data))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
    void api.get<{ data: UploadIssueRemediationMap }>('/admin/upload-quality/remediations')
      .then((res) => setRemediations(res.data))
      .catch(() => {});
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
      {message && <AppAlert variant="success" dismissible onClose={() => setMessage('')}>{message}</AppAlert>}

      <ScrollArea>
        <Card className="mb-3">
          <Card.Header>修正ガイド管理</Card.Header>
          <Card.Body>
            <div className="row g-2">
              <div className="col-md-3">
                <Form.Select
                  value={editingCode}
                  onChange={(event) => {
                    const nextCode = event.target.value;
                    setEditingCode(nextCode);
                    const current = remediations[nextCode] ?? { cause: '', fix: '', verify: '' };
                    setEditingRemediation(current);
                    if (nextCode) {
                      void api.get<{ data: Array<{ id: number; cause: string; fix: string; verify: string; createdAt: string | null }> }>(
                        `/admin/upload-quality/remediations/${encodeURIComponent(nextCode)}/history`,
                      ).then((res) => setRemediationHistory(res.data)).catch(() => setRemediationHistory([]));
                    } else {
                      setRemediationHistory([]);
                    }
                  }}
                >
                  <option value="">エラーコードを選択</option>
                  {summary?.issuesByCode.map((c) => (
                    <option key={c.issueCode} value={c.issueCode}>{c.issueCode}</option>
                  ))}
                </Form.Select>
              </div>
              <div className="col-md-9">
                <Form.Control
                  className="mb-2"
                  placeholder="原因"
                  value={editingRemediation.cause}
                  onChange={(event) => setEditingRemediation((prev) => ({ ...prev, cause: event.target.value }))}
                />
                <Form.Control
                  className="mb-2"
                  placeholder="修正方法"
                  value={editingRemediation.fix}
                  onChange={(event) => setEditingRemediation((prev) => ({ ...prev, fix: event.target.value }))}
                />
                <Form.Control
                  placeholder="再確認手順"
                  value={editingRemediation.verify}
                  onChange={(event) => setEditingRemediation((prev) => ({ ...prev, verify: event.target.value }))}
                />
                <div className="mt-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!editingCode || savingRemediation}
                    onClick={async () => {
                      if (!editingCode) return;
                      setSavingRemediation(true);
                      try {
                        const response = await api.put<{ data: { issueCode: string; cause: string; fix: string; verify: string } }>(
                          `/admin/upload-quality/remediations/${encodeURIComponent(editingCode)}`,
                          editingRemediation,
                        );
                        setRemediations((prev) => ({
                          ...prev,
                          [editingCode]: {
                            cause: response.data.cause,
                            fix: response.data.fix,
                            verify: response.data.verify,
                          },
                        }));
                        setMessage(`${editingCode} の修正ガイドを更新しました`);
                      } finally {
                        setSavingRemediation(false);
                      }
                    }}
                  >
                    {savingRemediation ? '保存中...' : '修正ガイドを保存'}
                  </button>
                </div>
                {remediationHistory.length > 0 && (
                  <div className="mt-3 small text-muted">
                    {remediationHistory.slice(-3).reverse().map((entry) => (
                      <div key={entry.id} className="border rounded p-2 mb-2">
                        <div>{formatDateTimeJa(entry.createdAt)} / {entry.cause}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card.Body>
        </Card>
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

        <Card className="mb-3">
          <Card.Header>運用インサイト</Card.Header>
          <Card.Body className="small text-muted">
            <div>ガイド整備済み: {summary?.issuesByCode.filter((code) => remediations[code.issueCode]).length ?? 0} / {summary?.issuesByCode.length ?? 0}</div>
            <div className="mt-1">直近更新中のコード: {editingCode || '未選択'}</div>
            {summary?.issuesByCode[0] && (
              <div className="mt-1">現在もっとも多い issueCode: {summary.issuesByCode[0].issueCode}</div>
            )}
          </Card.Body>
        </Card>

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
