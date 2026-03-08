import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  createNotification: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  notInArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
}));

import {
  acceptInvitation,
  createGroup,
  declineInvitation,
  deleteGroup,
  getGroupDetail,
  inviteMember,
  joinPublicGroup,
  leaveGroup,
  listGroups,
  removeMember,
  updateMemberRole,
  updateGroup,
} from '../services/group-service';

function createSelectWhereResult(result: unknown) {
  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

function createSelectOrderLimitOffsetResult(result: unknown) {
  const offset = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ offset });
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, orderBy, limit, offset };
}

function createInsertReturningResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const values = vi.fn().mockReturnValue({ returning });
  return { values, returning };
}

function createUpdateReturningResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

function createDeleteResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  return { where, returning };
}

describe('group-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createGroup creates group + owner membership', async () => {
    const createdGroup = {
      id: 10,
      name: '共同在庫調整',
      description: '北部エリア',
      visibility: 'invite_only' as const,
      ownerPharmacyId: 1,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };
    const createdMember = {
      id: 30,
      groupId: 10,
      pharmacyId: 1,
      role: 'owner' as const,
      joinedAt: '2026-03-01T00:00:00.000Z',
    };

    mocks.db.insert
      .mockReturnValueOnce(createInsertReturningResult([createdGroup]))
      .mockReturnValueOnce(createInsertReturningResult([createdMember]));

    const result = await createGroup(1, {
      name: '共同在庫調整',
      description: '北部エリア',
      visibility: 'invite_only',
    });

    expect(result.id).toBe(10);
    expect(result.memberCount).toBe(1);
    expect(result.members[0]).toEqual(createdMember);
  });

  it('updateGroup rejects non-owner', async () => {
    const groupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1 },
    ]);
    mocks.db.select.mockReturnValueOnce({ from: groupQuery.from });

    await expect(updateGroup(10, 2, { name: '更新名' })).rejects.toThrow('グループオーナーのみ更新できます');
  });

  it('deleteGroup allows only owner', async () => {
    const groupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 2 },
    ]);
    const deleteQuery = createDeleteResult([{ id: 10 }]);
    mocks.db.select.mockReturnValueOnce({ from: groupQuery.from });
    mocks.db.delete.mockReturnValueOnce({ where: deleteQuery.where });

    await deleteGroup(10, 2);

    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
  });

  it('listGroups returns own groups and public groups outside membership', async () => {
    const ownGroups = [{
      id: 10,
      name: 'A',
      description: null,
      visibility: 'invite_only' as const,
      ownerPharmacyId: 1,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }];
    const publicGroups = [{
      id: 20,
      name: 'B',
      description: null,
      visibility: 'public' as const,
      ownerPharmacyId: 2,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }];

    const memberQuery = createSelectWhereResult([{ groupId: 10 }]);
    const ownQuery = createSelectWhereResult(ownGroups);
    const publicQuery = createSelectWhereResult(publicGroups);
    mocks.db.select
      .mockReturnValueOnce({ from: memberQuery.from })
      .mockReturnValueOnce({ from: ownQuery.from })
      .mockReturnValueOnce({ from: publicQuery.from });

    const result = await listGroups(1, { offset: 0, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.groups.map((g: { id: number }) => g.id)).toEqual([10, 20]);
  });

  it('getGroupDetail rejects invite_only access when requester is not member', async () => {
    const groupQuery = createSelectWhereResult([
      {
        id: 10,
        name: 'A',
        description: null,
        visibility: 'invite_only' as const,
        ownerPharmacyId: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    const membershipQuery = createSelectWhereResult([]);

    mocks.db.select
      .mockReturnValueOnce({ from: groupQuery.from })
      .mockReturnValueOnce({ from: membershipQuery.from });

    await expect(getGroupDetail(10, 2)).rejects.toThrow('このグループを閲覧する権限がありません');
  });

  it('inviteMember requires owner or admin role', async () => {
    const roleQuery = createSelectWhereResult([{ role: 'member' }]);
    mocks.db.select.mockReturnValueOnce({ from: roleQuery.from });

    await expect(inviteMember(10, 1, 2)).rejects.toThrow('招待できるのはオーナーまたは管理者のみです');
  });

  it('inviteMember creates group_invitation notification', async () => {
    const inviterRoleQuery = createSelectWhereResult([{ role: 'admin' }]);
    const inviteeMemberQuery = createSelectWhereResult([]);
    const existingInvitationQuery = createSelectWhereResult([]);
    mocks.db.select
      .mockReturnValueOnce({ from: inviterRoleQuery.from })
      .mockReturnValueOnce({ from: inviteeMemberQuery.from })
      .mockReturnValueOnce({ from: existingInvitationQuery.from });

    mocks.createNotification.mockResolvedValue({ id: 800 });

    await inviteMember(10, 1, 2);

    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        pharmacyId: 2,
        type: 'group_invitation',
        referenceId: 10,
      }),
    );
  });

  it('acceptInvitation adds member by invitation notification', async () => {
    const memberQuery = createSelectWhereResult([]);
    const invitationQuery = createSelectWhereResult([
      { id: 900, pharmacyId: 5, referenceId: 10, type: 'group_invitation', isRead: false },
    ]);
    const groupQuery = createSelectWhereResult([{ id: 10, ownerPharmacyId: 1 }]);
    const insertQuery = createInsertReturningResult([
      { id: 44, groupId: 10, pharmacyId: 5, role: 'member', joinedAt: '2026-03-01T00:00:00.000Z' },
    ]);
    const markReadQuery = createUpdateReturningResult([{ id: 900 }]);

    mocks.db.select
      .mockReturnValueOnce({ from: memberQuery.from })
      .mockReturnValueOnce({ from: invitationQuery.from })
      .mockReturnValueOnce({ from: groupQuery.from });
    mocks.db.insert.mockReturnValueOnce({ values: insertQuery.values });
    mocks.db.update.mockReturnValueOnce({ set: markReadQuery.set });

    await acceptInvitation(10, 5);

    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('declineInvitation marks invitation as read', async () => {
    const invitationQuery = createSelectWhereResult([
      { id: 901, pharmacyId: 5, referenceId: 10, type: 'group_invitation', isRead: false },
    ]);
    const markReadQuery = createUpdateReturningResult([{ id: 901 }]);

    mocks.db.select.mockReturnValueOnce({ from: invitationQuery.from });
    mocks.db.update.mockReturnValueOnce({ set: markReadQuery.set });

    await declineInvitation(10, 5);

    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('removeMember requires owner/admin and cannot remove owner', async () => {
    const actorRoleQuery = createSelectWhereResult([{ role: 'admin' }]);
    const targetRoleQuery = createSelectWhereResult([{ role: 'owner' }]);
    mocks.db.select
      .mockReturnValueOnce({ from: actorRoleQuery.from })
      .mockReturnValueOnce({ from: targetRoleQuery.from });

    await expect(removeMember(10, 3, 1)).rejects.toThrow('オーナーは削除できません');
  });

  it('leaveGroup rejects owner and allows member', async () => {
    const ownerRoleQuery = createSelectWhereResult([{ role: 'owner' }]);
    mocks.db.select.mockReturnValueOnce({ from: ownerRoleQuery.from });
    await expect(leaveGroup(10, 1)).rejects.toThrow('オーナーはグループを脱退できません');

    const memberRoleQuery = createSelectWhereResult([{ role: 'member' }]);
    const groupQuery = createSelectWhereResult([{ id: 10, ownerPharmacyId: 1 }]);
    const deleteQuery = createDeleteResult([{ id: 2 }]);
    mocks.db.select
      .mockReturnValueOnce({ from: memberRoleQuery.from })
      .mockReturnValueOnce({ from: groupQuery.from });
    mocks.db.delete.mockReturnValueOnce({ where: deleteQuery.where });

    await leaveGroup(10, 2);
    expect(mocks.db.delete).toHaveBeenCalledTimes(1);
  });

  it('updateMemberRole requires owner/admin and cannot change owner role', async () => {
    const actorRoleQuery = createSelectWhereResult([{ role: 'owner' }]);
    const targetRoleQuery = createSelectWhereResult([{ role: 'owner' }]);

    mocks.db.select
      .mockReturnValueOnce({ from: actorRoleQuery.from })
      .mockReturnValueOnce({ from: targetRoleQuery.from });

    await expect(updateMemberRole(10, 1, 2, 'member')).rejects.toThrow('オーナーのロールは変更できません');
  });

  it('listMembers returns paginated members after permission check', async () => {
    const groupQuery = createSelectWhereResult([
      {
        id: 10,
        name: 'A',
        description: null,
        visibility: 'public' as const,
        ownerPharmacyId: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    const listQuery = createSelectOrderLimitOffsetResult([
      { id: 1, groupId: 10, pharmacyId: 1, role: 'owner', joinedAt: '2026-03-01T00:00:00.000Z' },
      { id: 2, groupId: 10, pharmacyId: 2, role: 'member', joinedAt: '2026-03-02T00:00:00.000Z' },
    ]);
    const countQuery = createSelectWhereResult([{ id: 1 }, { id: 2 }]);

    mocks.db.select
      .mockReturnValueOnce({ from: groupQuery.from })
      .mockReturnValueOnce({ from: listQuery.from })
      .mockReturnValueOnce({ from: countQuery.from });

    const result = await getGroupDetail(10, 1, { offset: 0, limit: 10 });
    expect(result.members).toHaveLength(2);
    expect(result.memberCount).toBe(2);
  });

  it('joinPublicGroup adds member to public group without invitation', async () => {
    const groupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1, visibility: 'public' as const },
    ]);
    const memberQuery = createSelectWhereResult([]);
    const groupQuery2 = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1, visibility: 'public' as const },
    ]);
    const insertQuery = createInsertReturningResult([
      { id: 50, groupId: 10, pharmacyId: 5, role: 'member', joinedAt: '2026-03-01T00:00:00.000Z' },
    ]);

    mocks.db.select
      .mockReturnValueOnce({ from: groupQuery.from })
      .mockReturnValueOnce({ from: memberQuery.from })
      .mockReturnValueOnce({ from: groupQuery2.from });
    mocks.db.insert.mockReturnValueOnce({ values: insertQuery.values });

    await joinPublicGroup(10, 5);

    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
  });

  it('joinPublicGroup rejects invite_only group', async () => {
    const groupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1, visibility: 'invite_only' as const },
    ]);
    mocks.db.select.mockReturnValueOnce({ from: groupQuery.from });

    await expect(joinPublicGroup(10, 5)).rejects.toThrow('公開グループではないため参加できません');
  });

  it('joinPublicGroup rejects already-member', async () => {
    const groupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1, visibility: 'public' as const },
    ]);
    const memberQuery = createSelectWhereResult([
      { id: 44, groupId: 10, pharmacyId: 5, role: 'member' },
    ]);
    mocks.db.select
      .mockReturnValueOnce({ from: groupQuery.from })
      .mockReturnValueOnce({ from: memberQuery.from });

    await expect(joinPublicGroup(10, 5)).rejects.toThrow('既にグループメンバーです');
  });

});
