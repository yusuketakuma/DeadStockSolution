import { useState } from 'react';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface RelationshipItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  targetPharmacyId: number;
  targetPharmacyName: string | null;
  relationshipType: string;
  createdAt: string | null;
}

interface RelationshipsResponse {
  data: RelationshipItem[];
  pagination: { page: number; totalPages: number; total: number };
}

const TYPE_LABELS: Record<string, string> = {
  favorite: 'お気に入り',
  blocked: 'ブロック',
};

export default function AdminRelationshipsPage() {
  const [typeFilter, setTypeFilter] = useState('');

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<RelationshipItem, RelationshipsResponse>(
    (targetPage, signal) => {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (typeFilter) params.set('type', typeFilter);
      return api.get<RelationshipsResponse>(`/admin/relationships?${params}`, { signal });
    },
    { errorMessage: '関係性一覧の取得に失敗しました' },
  );

  return (
    <PageShell>
      <h4 className="page-title mb-3">関係性監査</h4>

      <Row className="mb-3 g-2">
        <Col xs={12} md={4}>
          <Form.Select size="sm" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">すべてのタイプ</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="関係性データを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState title="関係性データがありません" description="薬局間のお気に入り・ブロック関係が登録されるとここに表示されます。" />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>薬局</th>
                      <th>対象薬局</th>
                      <th>タイプ</th>
                      <th>登録日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.pharmacyName ?? `ID:${r.pharmacyId}`}</td>
                        <td>{r.targetPharmacyName ?? `ID:${r.targetPharmacyId}`}</td>
                        <td>
                          <Badge bg={r.relationshipType === 'favorite' ? 'success' : 'danger'}>
                            {TYPE_LABELS[r.relationshipType] ?? r.relationshipType}
                          </Badge>
                        </td>
                        <td>{formatDateTimeJa(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((r) => (
                  <AppMobileDataCard
                    key={r.id}
                    title={`${r.pharmacyName ?? `ID:${r.pharmacyId}`} → ${r.targetPharmacyName ?? `ID:${r.targetPharmacyId}`}`}
                    subtitle={`ID: ${r.id}`}
                    badges={
                      <Badge bg={r.relationshipType === 'favorite' ? 'success' : 'danger'}>
                        {TYPE_LABELS[r.relationshipType] ?? r.relationshipType}
                      </Badge>
                    }
                    fields={[
                      { label: '登録日', value: formatDateTimeJa(r.createdAt) },
                    ]}
                  />
                ))}
              </div>
            )}
          />
        )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
