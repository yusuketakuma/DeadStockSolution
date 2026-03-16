import { useState } from 'react';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppButton from '../../components/ui/AppButton';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AppModalShell from '../../components/ui/AppModalShell';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface GroupItem {
  id: number;
  name: string;
  description: string | null;
  visibility: string;
  ownerPharmacyId: number;
  ownerName: string | null;
  memberCount: number;
  createdAt: string | null;
}

interface GroupsResponse {
  data: GroupItem[];
  pagination: { page: number; totalPages: number; total: number };
}

interface GroupMember {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  role: string;
  joinedAt: string | null;
}

const VISIBILITY_LABELS: Record<string, string> = {
  public: '公開',
  invite_only: '招待制',
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  member: 'メンバー',
};

export default function AdminGroupsPage() {
  const [visibilityFilter, setVisibilityFilter] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<GroupItem, GroupsResponse>(
    (targetPage, signal) => {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (visibilityFilter) params.set('visibility', visibilityFilter);
      return api.get<GroupsResponse>(`/admin/groups?${params}`, { signal });
    },
    { errorMessage: 'グループ一覧の取得に失敗しました' },
  );

  const openMembers = async (group: GroupItem) => {
    setSelectedGroup(group);
    setMembersLoading(true);
    try {
      const res = await api.get<{ data: GroupMember[] }>(`/admin/groups/${group.id}`);
      setMembers(res.data);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">グループ管理</h4>

      <Row className="mb-3 g-2">
        <Col xs={12} md={4}>
          <Form.Select size="sm" value={visibilityFilter} onChange={(e) => { setVisibilityFilter(e.target.value); setPage(1); }}>
            <option value="">すべての公開設定</option>
            {Object.entries(VISIBILITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="グループを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState title="グループがありません" description="グループが作成されるとここに表示されます。" />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>グループ名</th>
                      <th>公開設定</th>
                      <th>オーナー</th>
                      <th>メンバー数</th>
                      <th>作成日</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((g) => (
                      <tr key={g.id}>
                        <td>{g.id}</td>
                        <td>{g.name}</td>
                        <td><Badge bg={g.visibility === 'public' ? 'success' : 'secondary'}>{VISIBILITY_LABELS[g.visibility] ?? g.visibility}</Badge></td>
                        <td>{g.ownerName ?? `ID:${g.ownerPharmacyId}`}</td>
                        <td>{g.memberCount}</td>
                        <td>{formatDateTimeJa(g.createdAt)}</td>
                        <td>
                          <AppButton size="sm" variant="outline-primary" onClick={() => void openMembers(g)}>メンバー</AppButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((g) => (
                  <AppMobileDataCard
                    key={g.id}
                    title={g.name}
                    subtitle={`ID: ${g.id}`}
                    badges={<Badge bg={g.visibility === 'public' ? 'success' : 'secondary'}>{VISIBILITY_LABELS[g.visibility] ?? g.visibility}</Badge>}
                    fields={[
                      { label: 'オーナー', value: g.ownerName ?? `ID:${g.ownerPharmacyId}` },
                      { label: 'メンバー数', value: String(g.memberCount) },
                      { label: '作成日', value: formatDateTimeJa(g.createdAt) },
                    ]}
                    actions={<AppButton size="sm" variant="outline-primary" onClick={() => void openMembers(g)}>メンバー</AppButton>}
                  />
                ))}
              </div>
            )}
          />
        )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <AppModalShell
        show={selectedGroup !== null}
        onHide={() => setSelectedGroup(null)}
        title={`${selectedGroup?.name ?? ''} のメンバー`}
        size="lg"
      >
        {membersLoading ? (
          <InlineLoader text="メンバーを読み込み中..." className="text-muted small" />
        ) : members.length === 0 ? (
          <div className="text-muted small">メンバーがいません。</div>
        ) : (
          <AppTable striped size="sm">
            <thead>
              <tr>
                <th>薬局ID</th>
                <th>薬局名</th>
                <th>ロール</th>
                <th>参加日</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.pharmacyId}</td>
                  <td>{m.pharmacyName ?? '—'}</td>
                  <td><Badge bg={m.role === 'owner' ? 'primary' : m.role === 'admin' ? 'info' : 'secondary'}>{ROLE_LABELS[m.role] ?? m.role}</Badge></td>
                  <td>{formatDateTimeJa(m.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </AppTable>
        )}
      </AppModalShell>
    </PageShell>
  );
}
