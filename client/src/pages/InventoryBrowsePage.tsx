import { useState, useEffect, FormEvent } from 'react';
import { Table, Form, Button, InputGroup, Alert, Badge } from 'react-bootstrap';
import { api } from '../api/client';
import Pagination from '../components/Pagination';

interface BusinessHoursStatus {
  isOpen: boolean;
  closingSoon: boolean;
  todayHours: { openTime: string; closeTime: string } | null;
}

interface BrowseItem {
  id: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  pharmacyName: string;
  prefecture: string;
  businessStatus?: BusinessHoursStatus;
}

interface BrowseResponse {
  data: BrowseItem[];
  pagination: { page: number; totalPages: number; total: number };
}

function BusinessStatusBadge({ status }: { status?: BusinessHoursStatus }) {
  if (!status) return <span className="text-muted">-</span>;

  if (status.closingSoon) {
    return <Badge bg="warning" text="dark">まもなく営業終了</Badge>;
  }
  if (!status.isOpen) {
    return <Badge bg="secondary">営業時間外</Badge>;
  }
  if (status.todayHours) {
    return <Badge bg="success">営業中</Badge>;
  }
  return <span className="text-muted">-</span>;
}

export default function InventoryBrowsePage() {
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchData = async (p: number, q: string) => {
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set('search', q);
    const data = await api.get<BrowseResponse>(`/inventory/browse?${params}`);
    setItems(data.data);
    setTotalPages(data.pagination.totalPages);
  };

  useEffect(() => { fetchData(page, search); }, [page, search]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  return (
    <div>
      <h4 className="page-title mb-3">全薬局の在庫参照</h4>

      <Form onSubmit={handleSearch} className="mb-3">
        <InputGroup>
          <Form.Control
            placeholder="薬品名で検索..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button type="submit" variant="primary">検索</Button>
          {search && (
            <Button variant="outline-secondary" onClick={() => { setSearch(''); setSearchInput(''); }}>
              クリア
            </Button>
          )}
        </InputGroup>
      </Form>

      {items.length === 0 ? (
        <Alert variant="secondary">
          {search ? `「${search}」に一致する在庫が見つかりません` : '在庫データがありません'}
        </Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover size="sm" className="mobile-table">
            <thead className="table-light">
              <tr>
                <th>薬品名</th>
                <th>数量</th>
                <th>単位</th>
                <th>薬価(単価)</th>
                <th>薬価(合計)</th>
                <th>使用期限</th>
                <th>薬局名</th>
                <th>都道府県</th>
                <th>営業状況</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.drugName}</td>
                  <td>{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td>{item.yakkaUnitPrice?.toLocaleString()}</td>
                  <td>{item.yakkaTotal?.toLocaleString()}</td>
                  <td>{item.expirationDate}</td>
                  <td>{item.pharmacyName}</td>
                  <td>{item.prefecture}</td>
                  <td><BusinessStatusBadge status={item.businessStatus} /></td>
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
