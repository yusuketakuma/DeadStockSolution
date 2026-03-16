import { useEffect, useState } from 'react';
import { Badge, Card, Col, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { formatDateTimeJa } from '../../utils/formatters';

interface StatusBreakdown {
  status: string;
  count: number;
}

interface CandidateDistItem {
  pharmacyId: number;
  candidateCount: number;
  updatedAt: string | null;
}

interface MatchingData {
  statusBreakdown: StatusBreakdown[];
  candidateDistribution: CandidateDistItem[];
  summary: { totalProposals: number; completedCount: number; successRate: number };
}

const STATUS_LABELS: Record<string, string> = {
  proposed: '提案中',
  accepted_a: 'A承認',
  accepted_b: 'B承認',
  confirmed: '確認済み',
  rejected: '却下',
  completed: '完了',
  cancelled: 'キャンセル',
};

export default function AdminMatchingPerformancePage() {
  const [data, setData] = useState<MatchingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: MatchingData }>('/admin/matching-performance');
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'マッチング性能情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  return (
    <PageShell>
      <h4 className="page-title mb-3">マッチング性能</h4>

      {error && <ErrorRetryAlert error={error} onRetry={() => void fetchData()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="マッチング性能を読み込み中..." className="text-muted small" />
        ) : data && (
          <>
            <Row className="mb-3 g-2">
              <Col xs={4}>
                <Card body className="text-center">
                  <div className="small text-muted">総提案数</div>
                  <div className="fs-4 fw-bold">{data.summary.totalProposals}</div>
                </Card>
              </Col>
              <Col xs={4}>
                <Card body className="text-center">
                  <div className="small text-muted">成立数</div>
                  <div className="fs-4 fw-bold text-success">{data.summary.completedCount}</div>
                </Card>
              </Col>
              <Col xs={4}>
                <Card body className="text-center">
                  <div className="small text-muted">成立率</div>
                  <div className="fs-4 fw-bold text-primary">{data.summary.successRate}%</div>
                </Card>
              </Col>
            </Row>

            <Row className="g-3">
              <Col xs={12} lg={6}>
                <Card>
                  <Card.Header>ステータス別件数</Card.Header>
                  <Card.Body className="p-0">
                    <AppTable striped size="sm" className="mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>ステータス</th>
                          <th>件数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.statusBreakdown.map((s) => (
                          <tr key={s.status}>
                            <td>
                              <Badge bg={s.status === 'completed' ? 'success' : s.status === 'rejected' ? 'danger' : 'secondary'}>
                                {STATUS_LABELS[s.status] ?? s.status}
                              </Badge>
                            </td>
                            <td>{s.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </AppTable>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={12} lg={6}>
                <Card>
                  <Card.Header>候補数分布（上位50薬局）</Card.Header>
                  <Card.Body className="p-0">
                    <AppTable striped size="sm" className="mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>薬局ID</th>
                          <th>候補数</th>
                          <th>更新日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.candidateDistribution.map((c) => (
                          <tr key={c.pharmacyId}>
                            <td>{c.pharmacyId}</td>
                            <td><Badge bg="primary">{c.candidateCount}</Badge></td>
                            <td className="small">{formatDateTimeJa(c.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </AppTable>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </ScrollArea>
    </PageShell>
  );
}
