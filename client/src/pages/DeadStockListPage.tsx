import { useState, useEffect } from 'react';
import { Table, Button, Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Pagination from '../components/Pagination';
import ConfirmActionModal from '../components/ConfirmActionModal';

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
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async (p: number) => {
    const data = await api.get<ListResponse>(`/inventory/dead-stock?page=${p}`);
    setItems(data.data);
    setTotalPages(data.pagination.totalPages);
    setTotal(data.pagination.total);
  };

  useEffect(() => { fetchData(page); }, [page]);

  const handleDeleteConfirmed = async () => {
    if (pendingDeleteId === null) return;
    setDeleting(true);
    try {
      await api.delete(`/inventory/dead-stock/${pendingDeleteId}`);
      setMessage('削除しました');
      fetchData(page);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'エラー');
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
      {message && <Alert variant="info" onClose={() => setMessage('')} dismissible>{message}</Alert>}

      {items.length === 0 ? (
        <Alert variant="secondary">デッドストックデータがありません。Excelファイルをアップロードしてください。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover size="sm">
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
                    <Button size="sm" variant="outline-danger" onClick={() => setPendingDeleteId(item.id)}>
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
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
