import { useCallback, useState, useMemo } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppButton from '../../components/ui/AppButton';
import AppAlert from '../../components/ui/AppAlert';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { Badge, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateJa, formatNumberJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';

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

function isPendingVerification(pharmacy: Pharmacy): boolean {
  return pharmacy.verificationStatus === 'pending_verification';
}

function collectPendingPharmacyIds(pharmacies: Pharmacy[]): number[] {
  return pharmacies.filter(isPendingVerification).map((pharmacy) => pharmacy.id);
}

function toggleSelectedPharmacy(current: Set<number>, id: number): Set<number> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

const PHARMACY_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '薬局運用',
    description: '薬局の状態確認と周辺設定をまとめています。',
    links: [
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/groups', label: 'グループ管理' },
    ],
  },
  {
    title: '承認・対応',
    description: '審査や関係性確認に近い画面です。',
    links: [
      { to: '/admin/bulk-actions', label: '一括操作' },
      { to: '/admin/relationships', label: '関係性監査' },
      { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
    ],
  },
] as const;

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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');

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

  // 承認待ち件数
  const pendingCount = useMemo(() =>
    pharmacies.filter(isPendingVerification).length,
    [pharmacies]
  );

  // タブに応じたフィルタリング
  const filteredPharmacies = useMemo(() =>
    activeTab === 'pending'
      ? pharmacies.filter(isPendingVerification)
      : pharmacies,
    [pharmacies, activeTab]
  );

  // 選択中の薬局のうち、審査可能な（pending_verification）もののみを抽出
  const selectablePharmacyIds = useMemo(() =>
    collectPendingPharmacyIds(filteredPharmacies),
    [filteredPharmacies]
  );

  const isAllSelected = selectablePharmacyIds.length > 0 &&
    selectablePharmacyIds.every(id => selectedIds.has(id));
  const isPartialSelected = !isAllSelected && selectablePharmacyIds.some(id => selectedIds.has(id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => toggleSelectedPharmacy(prev, id));
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectablePharmacyIds));
    }
  };

  const runBulkAction = async (
    endpoint: '/admin/pharmacies/bulk-verify' | '/admin/pharmacies/bulk-reject',
    fallbackMessage: string,
  ) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setActionError('');
    try {
      const result = await api.post<{ message: string }>(endpoint, {
        pharmacyIds: Array.from(selectedIds),
      });
      setMessage(result.message);
      setSelectedIds(new Set());
      await fetchPage(page);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkVerify = async () => {
    await runBulkAction('/admin/pharmacies/bulk-verify', '一括承認に失敗しました');
  };

  const handleBulkReject = async () => {
    await runBulkAction('/admin/pharmacies/bulk-reject', '一括拒否に失敗しました');
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">薬局管理</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/groups" className="btn btn-outline-secondary btn-sm">グループ管理</Link>
          <Link to="/admin/pharmacy-health" className="btn btn-outline-secondary btn-sm">薬局ヘルス</Link>
          <Link to="/admin/business-hours" className="btn btn-outline-secondary btn-sm">営業時間</Link>
          <Link to="/admin/bulk-actions" className="btn btn-outline-secondary btn-sm">一括操作</Link>
        </div>
      </div>
      <ScrollArea>
      <AdminNavigationLinks groups={PHARMACY_LINK_GROUPS} />
      <Nav variant="tabs" className="mb-3" activeKey={activeTab} onSelect={(k) => setActiveTab((k as 'all' | 'pending') || 'all')}>
        <Nav.Item>
          <Nav.Link eventKey="all">
            全て <Badge bg="secondary">{pharmacies.length}</Badge>
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="pending">
            承認待ち {pendingCount > 0 && <Badge bg="warning" text="dark">{pendingCount}</Badge>}
          </Nav.Link>
        </Nav.Item>
      </Nav>
      <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
        <AppButton size="sm" variant="outline-primary" onClick={() => void recalculateTrustScores()} disabled={recalculating}>
          {recalculating ? '再計算中...' : '信頼スコアを再計算'}
        </AppButton>
        {selectedIds.size > 0 && (
          <>
            <span className="text-muted small">選択中: {selectedIds.size}件</span>
            <AppButton
              size="sm"
              variant="outline-success"
              onClick={() => void handleBulkVerify()}
              disabled={bulkLoading}
            >
              {bulkLoading ? '処理中...' : '一括承認'}
            </AppButton>
            <AppButton
              size="sm"
              variant="outline-danger"
              onClick={() => void handleBulkReject()}
              disabled={bulkLoading}
            >
              {bulkLoading ? '処理中...' : '一括拒否'}
            </AppButton>
          </>
        )}
      </div>
      {message && <AppAlert variant="info" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {actionError && <AppAlert variant="danger" onClose={() => setActionError('')} dismissible>{actionError}</AppAlert>}
      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void retry()} />
      )}
      {loading ? (
        <InlineLoader text="薬局データを読み込み中..." className="text-muted small" />
      ) : filteredPharmacies.length === 0 ? (
        <AppEmptyState
          title={activeTab === 'pending' ? '承認待ちの薬局はありません' : '薬局データがありません'}
          description={activeTab === 'pending' ? '現在、審査待ちの薬局はありません。' : '登録が追加されるとここに表示されます。'}
          action={(
            <div className="mt-3 d-flex gap-2 flex-wrap justify-content-center">
              <Link to={activeTab === 'pending' ? '/admin/business-hours' : '/admin/pharmacy-health'} className="btn btn-outline-secondary btn-sm">
                {activeTab === 'pending' ? '営業時間を確認' : '薬局ヘルスを見る'}
              </Link>
              <Link to="/admin/bulk-actions" className="btn btn-outline-secondary btn-sm">一括操作</Link>
              <Link to="/admin/relationships" className="btn btn-outline-secondary btn-sm">関係性監査</Link>
            </div>
          )}
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <AppTable striped hover responsive>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={el => {
                        if (el) el.indeterminate = isPartialSelected;
                      }}
                      onChange={toggleSelectAll}
                      title="全選択"
                    />
                  </th>
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
                {filteredPharmacies.map((p) => {
                  const isSelectable = p.verificationStatus === 'pending_verification';
                  const isSelected = selectedIds.has(p.id);
                  return (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!isSelectable}
                        onChange={() => toggleSelect(p.id)}
                        title={isSelectable ? '選択' : '審査中以外は選択不可'}
                      />
                    </td>
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
                  );
                })}
              </tbody>
            </AppTable>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {filteredPharmacies.map((p) => {
                const isSelectable = p.verificationStatus === 'pending_verification';
                const isSelected = selectedIds.has(p.id);
                return (
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
                    <div className="d-flex gap-2 align-items-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!isSelectable}
                        onChange={() => toggleSelect(p.id)}
                        title={isSelectable ? '選択' : '審査中以外は選択不可'}
                      />
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
                );
              })}
            </div>
          )}
        />
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </ScrollArea>
    </PageShell>
  );
}
