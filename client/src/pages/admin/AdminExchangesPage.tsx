import { useState, useEffect } from 'react';
import { Table, Alert, Badge } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

interface ExchangeHistoryItem {
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
  data: ExchangeHistoryItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function AdminExchangesPage() {
  const [history, setHistory] = useState<ExchangeHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api.get<HistoryResponse>(`/admin/history?page=${page}`).then((data) => {
      setHistory(data.data);
      setTotalPages(data.pagination.totalPages);
    });
  }, [page]);

  return (
    <div>
      <h4 className="page-title mb-3">交換履歴（管理者）</h4>
      {history.length === 0 ? (
        <Alert variant="secondary">交換履歴データがありません。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover className="mobile-table">
            <thead className="table-light">
              <tr>
                <th>履歴ID</th>
                <th>提案ID</th>
                <th>薬局A</th>
                <th>薬局B</th>
                <th>交換金額</th>
                <th>完了日時</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.proposalId}</td>
                  <td>{item.pharmacyAName} (ID:{item.pharmacyAId})</td>
                  <td>{item.pharmacyBName} (ID:{item.pharmacyBId})</td>
                  <td>{item.totalValue?.toLocaleString() ?? 0}円</td>
                  <td>{item.completedAt ? new Date(item.completedAt).toLocaleString('ja-JP') : '-'}</td>
                  <td><Badge bg="secondary">完了</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
