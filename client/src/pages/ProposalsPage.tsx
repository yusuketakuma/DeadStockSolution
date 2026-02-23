import { useState, useEffect } from 'react';
import { Table, Badge, Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Pagination from '../components/Pagination';

interface Proposal {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  pharmacyAName: string;
  pharmacyBName: string;
  status: string;
  totalValueA: number | null;
  totalValueB: number | null;
  valueDifference: number | null;
  proposedAt: string | null;
}

interface ProposalsResponse {
  data: Proposal[];
  pagination: { page: number; totalPages: number; total: number };
}

const STATUS_LABELS: Record<string, { label: string; variant: string }> = {
  proposed: { label: '提案中', variant: 'primary' },
  accepted_a: { label: 'A承認済', variant: 'info' },
  accepted_b: { label: 'B承認済', variant: 'info' },
  confirmed: { label: '確定', variant: 'success' },
  completed: { label: '完了', variant: 'secondary' },
  rejected: { label: '拒否', variant: 'danger' },
  cancelled: { label: 'キャンセル', variant: 'dark' },
};

export default function ProposalsPage() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api.get<ProposalsResponse>(`/exchange/proposals?page=${page}`).then((data) => {
      setProposals(data.data);
      setTotalPages(data.pagination.totalPages);
    });
  }, [page]);

  return (
    <div>
      <h4 className="page-title mb-3">交換提案一覧</h4>
      {proposals.length === 0 ? (
        <Alert variant="secondary">交換提案はまだありません。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover className="mobile-table">
            <thead className="table-light">
              <tr>
                <th>ID</th>
                <th>相手薬局</th>
                <th>ステータス</th>
                <th className="mobile-hide">A側薬価</th>
                <th className="mobile-hide">B側薬価</th>
                <th className="mobile-hide">差額</th>
                <th>提案日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => {
                const isA = p.pharmacyAId === user?.id;
                const otherName = isA ? p.pharmacyBName : p.pharmacyAName;
                const statusInfo = STATUS_LABELS[p.status] || { label: p.status, variant: 'secondary' };

                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{otherName}</td>
                    <td><Badge bg={statusInfo.variant}>{statusInfo.label}</Badge></td>
                    <td className="mobile-hide">{p.totalValueA?.toLocaleString()}円</td>
                    <td className="mobile-hide">{p.totalValueB?.toLocaleString()}円</td>
                    <td className="mobile-hide">{p.valueDifference}円</td>
                    <td>{p.proposedAt ? new Date(p.proposedAt).toLocaleDateString('ja-JP') : ''}</td>
                    <td><Link to={`/proposals/${p.id}`} className="btn btn-sm btn-outline-primary">詳細</Link></td>
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
