import { useCallback, useState } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppButton from '../../components/ui/AppButton';
import AppAlert from '../../components/ui/AppAlert';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateJa, formatNumberJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface Pharmacy {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  phone: string;
  fax: string;
  isActive: boolean;
  isAdmin: boolean;
  isTestAccount: boolean;
  createdAt: string;
  trustScore?: number;
  ratingCount?: number;
  positiveRate?: number;
  verificationStatus?: string;
}

interface PharmaciesResponse {
  data: Pharmacy[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function AdminPharmaciesPage() {
  const fetchPharmacies = useCallback((targetPage: number, signal?: AbortSignal) =>
    api.get<PharmaciesResponse>(`/admin/pharmacies/trust?page=${targetPage}`, { signal }), []);
  const {
    items: pharmacies,
    page,
    setPage,
    totalPages,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<Pharmacy, PharmaciesResponse>(fetchPharmacies, {
    errorMessage: '薬局データの取得に失敗しました',
  });
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const toggleActive = async (id: number) => {
    setActionError('');
    setUpdatingId(id);
    try {
      const result = await api.put<{ message: string }>(`/admin/pharmacies/${id}/toggle-active`);
      setMessage(result.message);
      await fetchPage(page);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ステータス更新に失敗しました');
    } finally {
      setUpdatingId(null);
    }
  };

  const recalculateTrustScores = async () => {
    setRecalculating(true);
    setActionError('');
    try {
      const result = await api.post<{ message: string; started?: boolean }>('/admin/pharmacies/trust/recalculate');
      setMessage(
        result.started === false
          ? result.message
          : `${result.message}（完了後に一覧を再読み込みしてください）`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '信頼スコア再計算に失敗しました');
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">薬局管理</h4>
      <div className="mb-3">
        <AppButton size="sm" variant="outline-primary" onClick={() => void recalculateTrustScores()} disabled={recalculating}>
          {recalculating ? '再計算中...' : '信頼スコアを再計算'}
        </AppButton>
      </div>
      {message && <AppAlert variant="info" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {actionError && <AppAlert variant="danger" onClose={() => setActionError('')} dismissible>{actionError}</AppAlert>}
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}
      <ScrollArea>
      {loading ? (
        <InlineLoader text="薬局データを読み込み中..." className="text-muted small" />
      ) : pharmacies.length === 0 ? (
        <AppEmptyState
          title="薬局データがありません"
          description="登録が追加されるとここに表示されます。"
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <AppTable striped hover responsive>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>薬局名</th>
                  <th>メール</th>
                  <th>都道府県</th>
                  <th>電話</th>
                  <th>FAX</th>
                  <th>登録日</th>
                  <th>信頼スコア</th>
                  <th>評価件数</th>
                  <th>審査</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pharmacies.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>
                      {p.name}
                      {' '}
                      {p.isAdmin && <Badge bg="danger">Admin</Badge>}
                      {' '}
                      {p.isTestAccount && <Badge bg="warning" text="dark">テスト</Badge>}
                    </td>
                    <td>{p.email}</td>
                    <td>{p.prefecture}</td>
                    <td>{p.phone}</td>
                    <td>{p.fax}</td>
                    <td>{formatDateJa(p.createdAt)}</td>
                    <td>{(p.trustScore ?? 60).toFixed(1)}</td>
                    <td>{formatNumberJa(p.ratingCount ?? 0)}</td>
                    <td>
                      {p.verificationStatus === 'verified' && <Badge bg="success">承認済み</Badge>}
                      {p.verificationStatus === 'pending_verification' && <Badge bg="warning" text="dark">審査中</Badge>}
                      {p.verificationStatus === 'rejected' && <Badge bg="danger">却下</Badge>}
                      {!p.verificationStatus && <Badge bg="secondary">未検証</Badge>}
                    </td>
                    <td>
                      <Badge bg={p.isActive ? 'success' : 'secondary'}>
                        {p.isActive ? '有効' : '無効'}
                      </Badge>
                    </td>
                    <td>
                      <div className="d-flex gap-2">
                        <Link
                          to={`/admin/pharmacies/${p.id}/edit`}
                          className="btn btn-outline-primary btn-sm"
                        >
                          編集
                        </Link>
                        <AppButton
                          size="sm"
                          variant={p.isActive ? 'outline-warning' : 'outline-success'}
                          onClick={() => void toggleActive(p.id)}
                          disabled={updatingId === p.id}
                        >
                          {updatingId === p.id ? '更新中...' : p.isActive ? '無効にする' : '有効にする'}
                        </AppButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {pharmacies.map((p) => (
                <AppMobileDataCard
                  key={p.id}
                  title={`${p.name} (ID:${p.id})`}
                  subtitle={p.email}
                  badges={(
                    <>
                      {p.isAdmin && <Badge bg="danger">Admin</Badge>}
                      {p.isTestAccount && <Badge bg="warning" text="dark">テスト</Badge>}
                      {p.verificationStatus === 'verified' && <Badge bg="success">承認済み</Badge>}
                      {p.verificationStatus === 'pending_verification' && <Badge bg="warning" text="dark">審査中</Badge>}
                      {p.verificationStatus === 'rejected' && <Badge bg="danger">却下</Badge>}
                      {!p.verificationStatus && <Badge bg="secondary">未検証</Badge>}
                      <Badge bg={p.isActive ? 'success' : 'secondary'}>
                        {p.isActive ? '有効' : '無効'}
                      </Badge>
                    </>
                  )}
                  fields={[
                    { label: '都道府県', value: p.prefecture },
                    { label: '電話', value: p.phone },
                    { label: 'FAX', value: p.fax },
                    { label: '登録日', value: formatDateJa(p.createdAt) },
                    { label: '信頼スコア', value: (p.trustScore ?? 60).toFixed(1) },
                    { label: '評価件数', value: formatNumberJa(p.ratingCount ?? 0) },
                  ]}
                  actions={(
                    <div className="d-flex gap-2">
                      <Link
                        to={`/admin/pharmacies/${p.id}/edit`}
                        className="btn btn-outline-primary btn-sm"
                      >
                        編集
                      </Link>
                      <AppButton
                        size="sm"
                        variant={p.isActive ? 'outline-warning' : 'outline-success'}
                        onClick={() => void toggleActive(p.id)}
                        disabled={updatingId === p.id}
                      >
                        {updatingId === p.id ? '更新中...' : p.isActive ? '無効にする' : '有効にする'}
                      </AppButton>
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
