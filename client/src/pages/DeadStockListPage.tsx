import { useState, useEffect } from 'react';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import ConfirmActionModal from '../components/ConfirmActionModal';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';

interface DeadStockItem {
  id: number;
  drugName: string;
  drugCode: string | null;
  quantity: number;
  unit: string | null;
  packageLabel?: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
  isAvailable: boolean;
}

interface ListResponse {
  data: DeadStockItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function DeadStockListPage() {
  const [items, setItems] = useState<DeadStockItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<ListResponse>(`/inventory/dead-stock?page=${p}`);
      setItems(data.data);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'デッドストック一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(page); }, [page]);

  const handleDeleteConfirmed = async () => {
    if (pendingDeleteId === null) return;
    setDeleting(true);
    setError('');
    try {
      await api.delete(`/inventory/dead-stock/${pendingDeleteId}`);
      setMessage('削除しました');
      await fetchData(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const pendingItem = pendingDeleteId === null
    ? null
    : items.find((item) => item.id === pendingDeleteId) ?? null;

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">デッドストックリスト ({total}件)</h4>
        <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
      </div>
      {message && <AppAlert variant="info" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && (
        <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>{error}</span>
          <AppButton size="sm" variant="outline-danger" onClick={() => void fetchData(page)}>
            再試行
          </AppButton>
        </AppAlert>
      )}

      {loading ? (
        <InlineLoader text="デッドストック一覧を読み込み中..." className="text-muted small" />
      ) : items.length === 0 ? (
        <AppEmptyState
          title="デッドストックデータがありません"
          description="Excelファイルをアップロードすると一覧に表示されます。"
          actionLabel="アップロードへ進む"
          actionTo="/upload"
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover size="sm">
                <thead className="table-light">
                  <tr>
                    <th>薬品名</th>
                    <th>コード</th>
                    <th>数量</th>
                    <th>単位</th>
                    <th>包装</th>
                    <th>薬価(単価)</th>
                    <th>薬価(合計)</th>
                    <th>使用期限</th>
                    <th>ロット</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.drugName}</td>
                      <td className="small text-muted">{item.drugCode}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>{item.packageLabel || '-'}</td>
                      <td>{item.yakkaUnitPrice?.toLocaleString()}</td>
                      <td>{item.yakkaTotal?.toLocaleString()}</td>
                      <td>{item.expirationDate}</td>
                      <td className="small">{item.lotNumber}</td>
                      <td>
                        <AppButton size="sm" variant="outline-danger" onClick={() => setPendingDeleteId(item.id)}>
                          削除
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
              {items.map((item) => (
                <AppMobileDataCard
                  key={item.id}
                  title={item.drugName}
                  subtitle={item.drugCode || '-'}
                  fields={[
                    { label: '数量', value: item.quantity },
                    { label: '単位', value: item.unit || '-' },
                    { label: '包装', value: item.packageLabel || '-' },
                    { label: '薬価(単価)', value: item.yakkaUnitPrice?.toLocaleString() ?? '-' },
                    { label: '薬価(合計)', value: item.yakkaTotal?.toLocaleString() ?? '-' },
                    { label: '使用期限', value: item.expirationDate || '-' },
                    { label: 'ロット', value: item.lotNumber || '-' },
                  ]}
                  actions={(
                    <AppButton size="sm" variant="outline-danger" onClick={() => setPendingDeleteId(item.id)}>
                      削除
                    </AppButton>
                  )}
                />
              ))}
            </div>
          )}
        />
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <ConfirmActionModal
        show={pendingDeleteId !== null}
        title="デッドストックデータの削除"
        body={pendingItem
          ? `「${pendingItem.drugName}」をデッドストックリストから削除します。よろしいですか？`
          : 'このデッドストックデータを削除します。よろしいですか？'}
        confirmLabel="削除する"
        confirmVariant="danger"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={handleDeleteConfirmed}
        pending={deleting}
      />
    </div>
  );
}
