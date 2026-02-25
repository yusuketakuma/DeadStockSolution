import { useState, useEffect } from 'react';
import { Table, Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Pagination from '../components/Pagination';

interface UsedMedicationItem {
  id: number;
  drugName: string;
  drugCode: string | null;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface ListResponse {
  data: UsedMedicationItem[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function UsedMedicationListPage() {
  const [items, setItems] = useState<UsedMedicationItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.get<ListResponse>(`/inventory/used-medication?page=${page}`).then((data) => {
      setItems(data.data);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    });
  }, [page]);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">医薬品使用量リスト ({total}件)</h4>
        <Link to="/upload" className="btn btn-primary btn-sm">アップロード</Link>
      </div>

      {items.length === 0 ? (
        <Alert variant="secondary">医薬品使用量データがありません。Excelファイルをアップロードしてください。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover size="sm">
            <thead className="table-light">
              <tr>
                <th>薬品名</th>
                <th>コード</th>
                <th>月間使用量</th>
                <th>単位</th>
                <th>薬価(単価)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.drugName}</td>
                  <td className="small text-muted">{item.drugCode}</td>
                  <td>{item.monthlyUsage}</td>
                  <td>{item.unit}</td>
                  <td>{item.yakkaUnitPrice?.toLocaleString()}</td>
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
