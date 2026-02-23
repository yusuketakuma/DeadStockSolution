import { useState, useEffect } from 'react';
import { Table, Badge, Alert } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

interface Exchange {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  status: string;
  totalValueA: number | null;
  totalValueB: number | null;
  valueDifference: number | null;
  proposedAt: string | null;
  completedAt: string | null;
}

interface ExchangesResponse {
  data: Exchange[];
  pagination: { page: number; totalPages: number; total: number };
}

const STATUS_LABELS: Record<string, { label: string; variant: string }> = {
  proposed: { label: '提案中', variant: 'primary' },
  accepted_a: { label: 'A承認', variant: 'info' },
  accepted_b: { label: 'B承認', variant: 'info' },
  confirmed: { label: '確定', variant: 'success' },
  completed: { label: '完了', variant: 'secondary' },
  rejected: { label: '拒否', variant: 'danger' },
  cancelled: { label: 'キャンセル', variant: 'dark' },
};

export default function AdminExchangesPage() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api.get<ExchangesResponse>(`/admin/exchanges?page=${page}`).then((data) => {
      setExchanges(data.data);
      setTotalPages(data.pagination.totalPages);
    });
  }, [page]);

  return (
    <div>
      <h4 className="mb-3">全交換一覧（管理者）</h4>
      {exchanges.length === 0 ? (
        <Alert variant="secondary">交換データがありません。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover>
            <thead className="table-light">
              <tr>
                <th>ID</th>
                <th>薬局A (ID)</th>
                <th>薬局B (ID)</th>
                <th>ステータス</th>
                <th>A側薬価</th>
                <th>B側薬価</th>
                <th>差額</th>
                <th>提案日</th>
              </tr>
            </thead>
            <tbody>
              {exchanges.map((e) => {
                const statusInfo = STATUS_LABELS[e.status] || { label: e.status, variant: 'secondary' };
                return (
                  <tr key={e.id}>
                    <td>{e.id}</td>
                    <td>{e.pharmacyAId}</td>
                    <td>{e.pharmacyBId}</td>
                    <td><Badge bg={statusInfo.variant}>{statusInfo.label}</Badge></td>
                    <td>{e.totalValueA?.toLocaleString()}</td>
                    <td>{e.totalValueB?.toLocaleString()}</td>
                    <td>{e.valueDifference}</td>
                    <td>{e.proposedAt ? new Date(e.proposedAt).toLocaleDateString('ja-JP') : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
