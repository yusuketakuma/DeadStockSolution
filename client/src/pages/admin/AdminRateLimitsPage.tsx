import { useEffect, useState } from 'react';
import { Alert, Badge, Table } from 'react-bootstrap';
import { api } from '../../api/client';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface RateLimiterConfig {
  name: string;
  windowMs: number;
  max: number;
  appliedTo: string[];
}

interface RateLimitsResponse {
  limiters: RateLimiterConfig[];
}

function formatWindowMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds}秒`;
  const minutes = seconds / 60;
  return `${minutes}分`;
}

export default function AdminRateLimitsPage() {
  const [limiters, setLimiters] = useState<RateLimiterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<RateLimitsResponse>('/admin/rate-limits/config');
        setLimiters(res.limiters);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'レート制限設定の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  return (
    <PageShell>
      <h4 className="page-title mb-3">レート制限設定</h4>

      <Alert variant="info" className="mb-3">
        現在の設定はインメモリ (express-rate-limit) で管理されています。将来 Redis 移行時にリアルタイムデータを表示予定です。
      </Alert>

      {error && <Alert variant="danger">{error}</Alert>}

      <ScrollArea>
        {loading ? (
          <div className="text-muted">読み込み中...</div>
        ) : (
          <Table bordered hover responsive size="sm">
            <thead className="table-light">
              <tr>
                <th>名前</th>
                <th>ウィンドウ</th>
                <th>最大リクエスト数</th>
                <th>適用先</th>
              </tr>
            </thead>
            <tbody>
              {limiters.map((limiter) => (
                <tr key={limiter.name}>
                  <td>
                    <code>{limiter.name}</code>
                  </td>
                  <td>{formatWindowMs(limiter.windowMs)}</td>
                  <td>
                    <Badge bg="secondary">{limiter.max} req</Badge>
                  </td>
                  <td>
                    {limiter.appliedTo.map((path) => (
                      <div key={path}>
                        <code className="small">{path}</code>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ScrollArea>
    </PageShell>
  );
}
