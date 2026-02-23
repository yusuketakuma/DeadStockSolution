import { useState, useEffect } from 'react';
import { Table, Badge, Button, Alert } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

interface Pharmacy {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  phone: string;
  fax: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
}

interface PharmaciesResponse {
  data: Pharmacy[];
  pagination: { page: number; totalPages: number; total: number };
}

export default function AdminPharmaciesPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [message, setMessage] = useState('');

  const fetchData = async (p: number) => {
    const data = await api.get<PharmaciesResponse>(`/admin/pharmacies?page=${p}`);
    setPharmacies(data.data);
    setTotalPages(data.pagination.totalPages);
  };

  useEffect(() => {
    fetchData(page);
  }, [page]);

  const toggleActive = async (id: number) => {
    try {
      const result = await api.put<{ message: string }>(`/admin/pharmacies/${id}/toggle-active`);
      setMessage(result.message);
      fetchData(page);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  };

  return (
    <div>
      <h4 className="mb-3">薬局管理</h4>
      {message && <Alert variant="info" onClose={() => setMessage('')} dismissible>{message}</Alert>}
      <Table striped hover responsive>
        <thead>
          <tr>
            <th>ID</th>
            <th>薬局名</th>
            <th>メール</th>
            <th>都道府県</th>
            <th>電話</th>
            <th>状態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {pharmacies.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.name} {p.isAdmin && <Badge bg="danger">Admin</Badge>}</td>
              <td>{p.email}</td>
              <td>{p.prefecture}</td>
              <td>{p.phone}</td>
              <td>
                <Badge bg={p.isActive ? 'success' : 'secondary'}>
                  {p.isActive ? '有効' : '無効'}
                </Badge>
              </td>
              <td>
                <Button
                  size="sm"
                  variant={p.isActive ? 'outline-warning' : 'outline-success'}
                  onClick={() => toggleActive(p.id)}
                >
                  {p.isActive ? '無効にする' : '有効にする'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
