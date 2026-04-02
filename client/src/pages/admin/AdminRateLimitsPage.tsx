import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Table } from 'react-bootstrap';
import { api } from '../../api/client';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';

interface RateLimiterConfig {
  name: string;
  windowMs: number;
  max: number;
  appliedTo: string[];
}

interface RateLimitsResponse {
  limiters: RateLimiterConfig[];
}

const RATE_LIMIT_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '障害切り分け',
    description: '制限超過や誤検知の確認時に使います。',
    links: [
      { to: '/admin/log-center', label: 'ログセンター' },
      { to: '/admin/error-codes', label: 'エラーコード' },
      { to: '/admin/notifications', label: '通知・配信状況' },
    ],
  },
  {
    title: '周辺設定',
    description: '制限設定の調整と周辺監査をまとめています。',
    links: [
      { to: '/admin/openclaw', label: 'OpenClaw連携' },
      { to: '/admin/audit', label: '監査ログ' },
      { to: '/admin', label: '管理ダッシュボード' },
    ],
  },
] as const;

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
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">レート制限設定</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin" className="btn btn-outline-secondary btn-sm">管理ダッシュボード</Link>
          <Link to="/admin/log-center" className="btn btn-outline-secondary btn-sm">ログセンター</Link>
          <Link to="/admin/openclaw" className="btn btn-outline-secondary btn-sm">OpenClaw連携</Link>
        </div>
      </div>

      <Alert variant="info" className="mb-3">
        現在の設定はインメモリ (express-rate-limit) で管理されています。将来 Redis 移行時にリアルタイムデータを表示予定です。
      </Alert>

      {error && <Alert variant="danger">{error}</Alert>}

      <ScrollArea>
        <AdminNavigationLinks groups={RATE_LIMIT_LINK_GROUPS} />
        {loading ? (
          <div className="text-muted">読み込み中...</div>
        ) : limiters.length === 0 ? (
          <AppEmptyState
            title="レート制限設定はまだ表示できる項目がありません"
            description="ログセンターや通知状況と合わせて監視対象を確認し、必要なら一括操作や周辺設定へ移動してください。"
            action={(
              <div className="mt-3 d-flex gap-2 flex-wrap justify-content-center">
                <Link to="/admin/log-center" className="btn btn-outline-secondary btn-sm">ログセンター</Link>
                <Link to="/admin/notifications" className="btn btn-outline-secondary btn-sm">通知・配信状況</Link>
                <Link to="/admin/openclaw" className="btn btn-outline-secondary btn-sm">OpenClaw連携</Link>
              </div>
            )}
          />
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
