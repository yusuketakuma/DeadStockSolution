import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';

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

const RELATIONSHIP_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '薬局・グループ',
    description: '関係性の発生源や影響先を確認するときに使います。',
    links: [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/groups', label: 'グループ管理' },
    ],
  },
  {
    title: '周辺運用',
    description: '営業時間や一括対応と合わせて運用状況を追えます。',
    links: [
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/bulk-actions', label: '一括操作' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
] as const;

export default function AdminRelationshipsPage() {
  const [typeFilter, setTypeFilter] = useState('');

  const fetchRelationships = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (typeFilter) params.set('type', typeFilter);
    return api.get<RelationshipsResponse>(`/admin/relationships?${params}`, { signal });
  }, [typeFilter]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<RelationshipItem, RelationshipsResponse>(
    fetchRelationships,
    { errorMessage: '関係性一覧の取得に失敗しました' },
  );

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">関係性監査</h4>
        </div>
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/pharmacies" className="btn btn-outline-primary btn-sm">薬局管理</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: '薬局ヘルス', to: '/admin/pharmacy-health' },
              { label: 'グループ管理', to: '/admin/groups' },
            ]}
          />
        </div>
      </div>

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
        <AdminNavigationLinks groups={RELATIONSHIP_LINK_GROUPS} />
        {loading ? (
          <InlineLoader text="関係性データを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState
            title="関係性データがありません"
            description="薬局間のお気に入り・ブロック関係が登録されるとここに表示されます。薬局一覧やグループ設定から近い運用面を確認できます。"
            action={(
              <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                <Link to="/admin/pharmacies" className="btn btn-outline-secondary btn-sm">薬局管理</Link>
                <AppDropdownMenu
                  label="関連"
                  variant="outline-secondary"
                  items={[
                    { key: 'pharmacy-health', to: '/admin/pharmacy-health', label: '薬局ヘルス' },
                    { key: 'business-hours', to: '/admin/business-hours', label: '営業時間' },
                  ]}
                />
              </div>
            )}
          />
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
                      <th>操作</th>
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
                        <td>
                          <div className="dl-action-row mobile-stack">
                            <Link to={`/admin/pharmacies/${r.pharmacyId}/edit`} className="btn btn-outline-primary btn-sm">元薬局を編集</Link>
                            <AppDropdownMenu
                              label="その他"
                              size="sm"
                              variant="outline-secondary"
                              items={[
                                { label: '対象薬局を編集', to: `/admin/pharmacies/${r.targetPharmacyId}/edit` },
                              ]}
                            />
                          </div>
                        </td>
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
                    actions={(
                      <div className="dl-action-row mobile-stack">
                        <Link to={`/admin/pharmacies/${r.pharmacyId}/edit`} className="btn btn-outline-primary btn-sm">元薬局を編集</Link>
                        <AppDropdownMenu
                          label="その他"
                          size="sm"
                          variant="outline-secondary"
                          items={[
                            { label: '対象薬局を編集', to: `/admin/pharmacies/${r.targetPharmacyId}/edit` },
                          ]}
                        />
                      </div>
                    )}
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
