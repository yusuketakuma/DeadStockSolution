import { useState, useEffect, useCallback } from 'react';
import { Tab, Nav, Badge, Form, Row, Col } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppTable from '../components/ui/AppTable';
import AppModalShell from '../components/ui/AppModalShell';
import LoadingButton from '../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import type { PharmacyGroup, GroupListResponse, GroupVisibility } from '../../../server/src/types/group';

type TabKey = 'mine' | 'public';

function buildGroupsQuery(activeTab: TabKey, search: string): string {
  const params = new URLSearchParams({ tab: activeTab });
  if (activeTab === 'public' && search) {
    params.set('search', search);
  }
  return params.toString();
}

function buildCreateGroupPayload(
  createName: string,
  createDescription: string,
  createVisibility: GroupVisibility,
) {
  return {
    name: createName.trim(),
    description: createDescription.trim() || undefined,
    visibility: createVisibility,
  };
}

export default function GroupListPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('mine');
  const [groups, setGroups] = useState<PharmacyGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 公開グループ検索
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // グループ作成モーダル
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createVisibility, setCreateVisibility] = useState<GroupVisibility>('public');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // 参加処理
  const [joiningId, setJoiningId] = useState<number | null>(null);

  const fetchGroups = useCallback(async (options?: { signal?: AbortSignal; searchQuery?: string }) => {
    const signal = options?.signal;
    setLoading(true);
    setError('');
    try {
      const params = buildGroupsQuery(activeTab, options?.searchQuery ?? search);
      const data = await api.get<GroupListResponse>(
        `/groups?${params}`,
        signal ? { signal } : undefined,
      );
      if (signal?.aborted) return;
      setGroups(data.groups);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'グループ一覧の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [activeTab, search]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchGroups({ signal: controller.signal });
    return () => controller.abort();
  }, [fetchGroups]);

  useEffect(() => {
    if (activeTab !== 'public') {
      return;
    }

    const timer = window.setTimeout(() => {
      setSearch(searchInput);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [activeTab, searchInput]);

  const handleSearch = (q: string) => {
    setSearchInput(q);
    if (q === search) {
      void fetchGroups({ searchQuery: q });
      return;
    }
    setSearch(q);
  };

  const handleTabChange = (key: string | null) => {
    if (key === 'mine' || key === 'public') {
      setActiveTab(key);
      setError('');
    }
  };

  const handleCreateGroup = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      await api.post('/groups', buildCreateGroupPayload(createName, createDescription, createVisibility));
      setShowCreateModal(false);
      resetCreateForm();
      await fetchGroups();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'グループの作成に失敗しました');
    } finally {
      setCreating(false);
    }
  };

  const resetCreateForm = () => {
    setCreateName('');
    setCreateDescription('');
    setCreateVisibility('public');
    setCreateError('');
  };

  const handleCloseCreateModal = () => {
    if (creating) return;
    setShowCreateModal(false);
    resetCreateForm();
  };

  const handleJoinGroup = async (groupId: number) => {
    setJoiningId(groupId);
    setError('');
    try {
      await api.post(`/groups/${groupId}/join`);
      await fetchGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'グループへの参加に失敗しました');
    } finally {
      setJoiningId(null);
    }
  };

  const visibilityLabel = (v: GroupVisibility) =>
    v === 'public' ? '公開' : '招待制';

  const visibilityBadgeBg = (v: GroupVisibility) =>
    v === 'public' ? 'success' : 'secondary';

  const renderDesktopTable = () => (
    <div className="table-responsive">
      <AppTable striped hover>
        <thead className="table-light">
          <tr>
            <th>グループ名</th>
            <th>説明</th>
            <th>公開設定</th>
            <th className="table-col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td>
                <Link to={`/groups/${g.id}`}>{g.name}</Link>
              </td>
              <td className="small text-muted">{g.description || '-'}</td>
              <td>
                <Badge bg={visibilityBadgeBg(g.visibility)}>
                  {visibilityLabel(g.visibility)}
                </Badge>
              </td>
              <td>
                {activeTab === 'mine' ? (
                  <Link to={`/groups/${g.id}`}>
                    <AppButton size="sm" variant="outline-primary">詳細</AppButton>
                  </Link>
                ) : g.visibility === 'public' ? (
                  <LoadingButton
                    size="sm"
                    variant="primary"
                    loading={joiningId === g.id}
                    loadingLabel="参加中..."
                    onClick={() => handleJoinGroup(g.id)}
                  >
                    参加
                  </LoadingButton>
                ) : (
                  <Badge bg="info">招待待ち</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </AppTable>
    </div>
  );

  const renderMobileCards = () => (
    <div className="dl-mobile-data-list">
      {groups.map((g) => (
        <AppMobileDataCard
          key={g.id}
          title={<Link to={`/groups/${g.id}`}>{g.name}</Link>}
          badges={
            <Badge bg={visibilityBadgeBg(g.visibility)}>
              {visibilityLabel(g.visibility)}
            </Badge>
          }
          fields={[
            { label: '説明', value: g.description || '-' },
          ]}
          actions={
            activeTab === 'mine' ? (
              <Link to={`/groups/${g.id}`}>
                <AppButton size="sm" variant="outline-primary">詳細</AppButton>
              </Link>
            ) : g.visibility === 'public' ? (
              <LoadingButton
                size="sm"
                variant="primary"
                loading={joiningId === g.id}
                loadingLabel="参加中..."
                onClick={() => handleJoinGroup(g.id)}
              >
                参加
              </LoadingButton>
            ) : (
              <Badge bg="info">招待待ち</Badge>
            )
          }
        />
      ))}
    </div>
  );

  const createModalFooter = (
    <>
      <AppButton variant="outline-secondary" onClick={handleCloseCreateModal} disabled={creating}>
        キャンセル
      </AppButton>
      <LoadingButton
        variant="primary"
        onClick={handleCreateGroup}
        loading={creating}
        loadingLabel="作成中..."
        disabled={!createName.trim()}
      >
        作成
      </LoadingButton>
    </>
  );

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">グループ一覧</h4>
        {user && (
          <AppButton variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            グループ作成
          </AppButton>
        )}
      </div>

      <Tab.Container activeKey={activeTab} onSelect={handleTabChange}>
        <Nav variant="tabs" className="mb-3">
          <Nav.Item>
            <Nav.Link eventKey="mine">マイグループ</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="public">公開グループ</Nav.Link>
          </Nav.Item>
        </Nav>

        {activeTab === 'public' && (
          <Row className="mb-3">
            <Col md={6}>
              <div className="d-flex gap-2">
                <Form.Control
                  type="text"
                  placeholder="グループ名で検索..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(searchInput); }}
                />
                <AppButton variant="primary" onClick={() => handleSearch(searchInput)}>検索</AppButton>
              </div>
            </Col>
          </Row>
        )}

        <ScrollArea>
          {error ? (
            <AppAlert variant="danger" dismissible onClose={() => setError('')}>{error}</AppAlert>
          ) : loading ? (
            <InlineLoader text="グループ一覧を読み込み中..." className="text-muted small" />
          ) : groups.length === 0 ? (
            <AppEmptyState
              title={
                activeTab === 'mine'
                  ? 'まだグループに参加していません'
                  : search
                    ? `「${search}」に一致するグループが見つかりません`
                    : '公開グループが見つかりません'
              }
              description={
                activeTab === 'mine'
                  ? '「グループ作成」ボタンから新しいグループを作成するか、公開グループに参加しましょう。'
                  : undefined
              }
            />
          ) : (
            <AppResponsiveSwitch
              desktop={renderDesktopTable}
              mobile={renderMobileCards}
            />
          )}
        </ScrollArea>
      </Tab.Container>

      {/* グループ作成モーダル */}
      <AppModalShell
        show={showCreateModal}
        title="グループ作成"
        onHide={handleCloseCreateModal}
        closeButton={!creating}
        footer={createModalFooter}
      >
        {createError && (
          <AppAlert variant="danger" className="mb-3">{createError}</AppAlert>
        )}
        <Form onSubmit={(e) => { e.preventDefault(); handleCreateGroup(); }}>
          <Form.Group className="mb-3">
            <Form.Label>グループ名 <span className="text-danger">*</span></Form.Label>
            <Form.Control
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="例: 東京都薬局グループ"
              required
              disabled={creating}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>説明</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              placeholder="グループの目的や対象地域などを記載（任意）"
              disabled={creating}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>公開設定</Form.Label>
            <Form.Select
              value={createVisibility}
              onChange={(e) => setCreateVisibility(e.target.value as GroupVisibility)}
              disabled={creating}
            >
              <option value="public">公開（誰でも参加可能）</option>
              <option value="invite_only">招待制（招待されたメンバーのみ）</option>
            </Form.Select>
          </Form.Group>
        </Form>
      </AppModalShell>
    </PageShell>
  );
}
