import { useState, useEffect } from 'react';
import { Table, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Pagination from '../components/Pagination';

interface HistoryItem {
  id: number;
  proposalId: number;
  pharmacyAId: number;
  pharmacyBId: number;
  pharmacyAName: string;
  pharmacyBName: string;
  totalValue: number | null;
  completedAt: string | null;
}

interface HistoryResponse {
  data: HistoryItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function ExchangeHistoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api.get<HistoryResponse>(`/exchange/history?page=${page}`).then((data) => {
      setItems(data.data);
      setTotalPages(data.pagination.totalPages);
    });
  }, [page]);

  return (
    <div>
      <h4 className="page-title mb-3">交換履歴</h4>
      {items.length === 0 ? (
        <Alert variant="secondary">交換履歴はまだありません。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover>
            <thead className="table-light">
              <tr>
                <th>ID</th>
                <th>相手薬局</th>
                <th>合計薬価</th>
                <th>完了日</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isA = item.pharmacyAId === user?.id;
                const otherName = isA ? item.pharmacyBName : item.pharmacyAName;

                return (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{otherName}</td>
                    <td>{item.totalValue?.toLocaleString()}円</td>
                    <td>{item.completedAt ? new Date(item.completedAt).toLocaleDateString('ja-JP') : ''}</td>
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
