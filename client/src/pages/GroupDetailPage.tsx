import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge, Form, Row, Col } from 'react-bootstrap';
import { api, ApiError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import AppDataPanel from '../components/ui/AppDataPanel';
import AppTable from '../components/ui/AppTable';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import InlineLoader from '../components/ui/InlineLoader';
import LoadingButton from '../components/ui/LoadingButton';
import ConfirmActionModal from '../components/ConfirmActionModal';
import AppModalShell from '../components/ui/AppModalShell';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import type { GroupDetailResponse, GroupMemberRole, GroupVisibility } from '../../../server/src/types/group';

type ConfirmAction = 'delete' | 'removeMember' | 'leave';

interface ConfirmState {
  action: ConfirmAction;
  targetPharmacyId?: number;
  targetName?: string;
}

function roleLabel(role: GroupMemberRole): string {
  switch (role) {
    case 'owner': return 'オーナー';
    case 'admin': return '管理者';
    case 'member': return 'メンバー';
  }
}

function roleBadgeBg(role: GroupMemberRole): string {
  switch (role) {
    case 'owner': return 'primary';
    case 'admin': return 'warning';
    case 'member': return 'secondary';
  }
}

function visibilityLabel(visibility: GroupVisibility) {
  return visibility === 'public' ? '公開' : '招待制';
}

function visibilityBadgeBg(visibility: GroupVisibility) {
  return visibility === 'public' ? 'success' : 'secondary';
}

function buildConfirmConfig(confirmState: ConfirmState | null, groupName?: string) {
  if (!confirmState) return { title: '', body: '', label: '', variant: 'danger' as const };
  switch (confirmState.action) {
    case 'delete':
      return {
        title: 'グループの削除',
        body: `「${groupName}」を削除します。この操作は取り消せません。`,
        label: '削除する',
        variant: 'danger' as const,
      };
    case 'removeMember':
      return {
        title: 'メンバーの除外',
        body: `薬局ID ${confirmState.targetPharmacyId} をグループから除外します。`,
        label: '除外する',
        variant: 'danger' as const,
      };
    case 'leave':
      return {
        title: 'グループの脱退',
        body: `「${groupName}」から脱退します。`,
        label: '脱退する',
        variant: 'warning' as const,
      };
  }
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [group, setGroup] = useState<GroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  // メンバー招待
  const [invitePharmacyId, setInvitePharmacyId] = useState('');
  const [inviting, setInviting] = useState(false);

  // グループ設定編集
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<GroupVisibility>('public');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // 確認モーダル
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  const fetchGroup = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get<GroupDetailResponse>(`/groups/${id}`);
      setGroup(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'グループ情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchGroup();
  }, [fetchGroup]);

  // 現在のユーザーのメンバー情報
  const currentMember = group?.members.find((m) => m.pharmacyId === user?.id);
  const isOwner = currentMember?.role === 'owner';
  const isAdmin = currentMember?.role === 'admin';
  const canManage = isOwner || isAdmin;

  // メンバー招待
  const handleInviteMember = async () => {
    const pharmacyId = parseInt(invitePharmacyId, 10);
    if (isNaN(pharmacyId) || !id) return;
    setInviting(true);
    setActionError('');
    try {
      await api.post(`/groups/${id}/invite`, { pharmacyId });
      setInvitePharmacyId('');
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'メンバーの招待に失敗しました');
    } finally {
      setInviting(false);
    }
  };

  // 確認アクションの実行
  const handleConfirmAction = async () => {
    if (!confirmState || !id) return;
    setConfirmPending(true);
    setActionError('');
    try {
      switch (confirmState.action) {
        case 'delete':
          await api.delete(`/groups/${id}`);
          navigate('/groups');
          return;
        case 'removeMember':
          if (confirmState.targetPharmacyId !== undefined) {
            await api.delete(`/groups/${id}/members/${confirmState.targetPharmacyId}`);
          }
          break;
        case 'leave':
          await api.post(`/groups/${id}/leave`);
          navigate('/groups');
          return;
      }
      setConfirmState(null);
      await fetchGroup();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : '操作に失敗しました');
      setConfirmState(null);
    } finally {
      setConfirmPending(false);
    }
  };

  // グループ設定編集
  const openEditModal = () => {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description || '');
    setEditVisibility(group.visibility);
    setEditError('');
    setShowEditModal(true);
  };

  const handleSaveSettings = async () => {
    if (!id || !editName.trim()) return;
    setSaving(true);
    setEditError('');
    try {
      await api.put(`/groups/${id}`, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        visibility: editVisibility,
      });
      setShowEditModal(false);
      await fetchGroup();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : '設定の更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseEditModal = () => {
    if (saving) return;
    setShowEditModal(false);
  };

  const confirmConfig = buildConfirmConfig(confirmState, group?.name);

  // 読み込み中 / エラー
  if (loading) {
    return (
      <PageShell>
        <InlineLoader text="グループ情報を読み込み中..." className="text-muted small" />
      </PageShell>
    );
  }

  if (error || !group) {
    return (
      <PageShell>
        <AppAlert variant="danger">{error || 'グループが見つかりません'}</AppAlert>
      </PageShell>
    );
  }

  const editModalFooter = (
    <>
      <AppButton variant="outline-secondary" onClick={handleCloseEditModal} disabled={saving}>
        キャンセル
      </AppButton>
      <LoadingButton
        variant="primary"
        onClick={handleSaveSettings}
        loading={saving}
        loadingLabel="保存中..."
        disabled={!editName.trim()}
      >
        保存
      </LoadingButton>
    </>
  );

  const renderMembersDesktop = () => (
    <div className="table-responsive">
      <AppTable striped hover>
        <thead className="table-light">
          <tr>
            <th>薬局ID</th>
            <th>ロール</th>
            {canManage && <th className="table-col-actions">操作</th>}
          </tr>
        </thead>
        <tbody>
          {group.members.map((m) => (
            <tr key={m.pharmacyId}>
              <td>{m.pharmacyId}</td>
              <td>
                <Badge bg={roleBadgeBg(m.role)} text={m.role === 'admin' ? 'dark' : undefined}>
                  {roleLabel(m.role)}
                </Badge>
              </td>
              {canManage && (
                <td>
                  {m.role !== 'owner' && (
                    <AppButton
                      size="sm"
                      variant="outline-danger"
                      onClick={() => setConfirmState({ action: 'removeMember', targetPharmacyId: m.pharmacyId })}
                    >
                      除外
                    </AppButton>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </AppTable>
    </div>
  );

  const renderMembersMobile = () => (
    <div className="dl-mobile-data-list">
      {group.members.map((m) => (
        <AppMobileDataCard
          key={m.pharmacyId}
          title={`薬局ID: ${m.pharmacyId}`}
          badges={
            <Badge bg={roleBadgeBg(m.role)} text={m.role === 'admin' ? 'dark' : undefined}>
              {roleLabel(m.role)}
            </Badge>
          }
          fields={[
            { label: 'ロール', value: roleLabel(m.role) },
          ]}
          actions={
            canManage && m.role !== 'owner' ? (
              <AppButton
                size="sm"
                variant="outline-danger"
                onClick={() => setConfirmState({ action: 'removeMember', targetPharmacyId: m.pharmacyId })}
              >
                除外
              </AppButton>
            ) : undefined
          }
        />
      ))}
    </div>
  );

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h4 className="page-title mb-0">{group.name}</h4>
        <div className="d-flex gap-2 flex-shrink-0">
          {canManage && (
            <AppButton size="sm" variant="outline-primary" onClick={openEditModal}>
              設定編集
            </AppButton>
          )}
          {isOwner && (
            <AppButton size="sm" variant="outline-danger" onClick={() => setConfirmState({ action: 'delete' })}>
              グループ削除
            </AppButton>
          )}
          {currentMember && !isOwner && (
            <AppButton size="sm" variant="outline-warning" onClick={() => setConfirmState({ action: 'leave' })}>
              脱退
            </AppButton>
          )}
        </div>
      </div>

      {actionError && (
        <AppAlert variant="danger" dismissible onClose={() => setActionError('')}>{actionError}</AppAlert>
      )}

      <ScrollArea>
        {/* グループ情報 */}
        <AppDataPanel title="グループ情報" className="mb-3">
          <Row>
            <Col xs={12} md={6}>
              <dl className="mb-0">
                <dt className="text-muted small">グループ名</dt>
                <dd>{group.name}</dd>
                <dt className="text-muted small">説明</dt>
                <dd>{group.description || '-'}</dd>
              </dl>
            </Col>
            <Col xs={12} md={6}>
              <dl className="mb-0">
                <dt className="text-muted small">公開設定</dt>
                <dd>
                  <Badge bg={visibilityBadgeBg(group.visibility)}>
                    {visibilityLabel(group.visibility)}
                  </Badge>
                </dd>
                <dt className="text-muted small">オーナー薬局ID</dt>
                <dd>{group.ownerPharmacyId}</dd>
                <dt className="text-muted small">メンバー数</dt>
                <dd>{group.memberCount}名</dd>
              </dl>
            </Col>
          </Row>
        </AppDataPanel>

        {/* メンバー招待（管理者のみ） */}
        {canManage && (
          <AppDataPanel title="メンバー招待" className="mb-3">
            <Form onSubmit={(e) => { e.preventDefault(); handleInviteMember(); }} className="d-flex gap-2 align-items-end">
              <Form.Group className="flex-grow-1">
                <Form.Label className="small">薬局ID</Form.Label>
                <Form.Control
                  type="number"
                  value={invitePharmacyId}
                  onChange={(e) => setInvitePharmacyId(e.target.value)}
                  placeholder="招待する薬局のIDを入力"
                  disabled={inviting}
                />
              </Form.Group>
              <LoadingButton
                variant="primary"
                onClick={handleInviteMember}
                loading={inviting}
                loadingLabel="招待中..."
                disabled={!invitePharmacyId.trim()}
              >
                招待
              </LoadingButton>
            </Form>
          </AppDataPanel>
        )}

        {/* メンバー一覧 */}
        <AppDataPanel title={`メンバー一覧（${group.memberCount}名）`}>
          {group.members.length === 0 ? (
            <p className="text-muted small mb-0">メンバーがいません</p>
          ) : (
            <AppResponsiveSwitch
              desktop={renderMembersDesktop}
              mobile={renderMembersMobile}
            />
          )}
        </AppDataPanel>
      </ScrollArea>

      {/* 確認モーダル */}
      <ConfirmActionModal
        show={confirmState !== null}
        title={confirmConfig.title}
        body={confirmConfig.body}
        confirmLabel={confirmConfig.label}
        confirmVariant={confirmConfig.variant}
        onCancel={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
        pending={confirmPending}
      />

      {/* 設定編集モーダル */}
      <AppModalShell
        show={showEditModal}
        title="グループ設定"
        onHide={handleCloseEditModal}
        closeButton={!saving}
        footer={editModalFooter}
      >
        {editError && (
          <AppAlert variant="danger" className="mb-3">{editError}</AppAlert>
        )}
        <Form onSubmit={(e) => { e.preventDefault(); handleSaveSettings(); }}>
          <Form.Group className="mb-3">
            <Form.Label>グループ名 <span className="text-danger">*</span></Form.Label>
            <Form.Control
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              disabled={saving}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>説明</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={saving}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>公開設定</Form.Label>
            <Form.Select
              value={editVisibility}
              onChange={(e) => setEditVisibility(e.target.value as GroupVisibility)}
              disabled={saving}
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
