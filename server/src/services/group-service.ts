import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm';
import { db } from '../config/database';
import { groupMembers, notifications, pharmacyGroups } from '../db/schema';
import type {
  GroupCreateRequest,
  GroupDetailResponse,
  GroupListResponse,
  PharmacyGroup,
  GroupMember,
  GroupMemberRole,
  GroupUpdateRequest,
} from '../types/group';
import { createNotification } from './notification-service';
import { logger } from './logger';
import { sendToPharmacy } from './push-dispatch-service';

type PharmacyGroupRow = typeof pharmacyGroups.$inferSelect;
type GroupMemberRow = typeof groupMembers.$inferSelect;

interface ListGroupFilters {
  limit?: number;
  offset?: number;
}

interface MemberListResponse {
  members: GroupMember[];
  total: number;
  offset: number;
  limit: number;
}

const DEFAULT_LIMIT = 20;

function hasPushDispatchConfig(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function sendGroupPush(pharmacyId: number, payload: {
  title: string;
  body: string;
  data: {
    url: string;
    type: string;
    referenceId?: string;
  };
}): Promise<void> {
  if (!hasPushDispatchConfig()) {
    return;
  }

  try {
    await sendToPharmacy(pharmacyId, payload);
  } catch (error) {
    logger.warn('Failed to dispatch group push notification', {
      pharmacyId,
      notificationType: payload.data.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizePaging(limit?: number, offset?: number): { limit: number; offset: number } {
  const safeLimit = Number.isInteger(limit) && (limit as number) > 0 ? (limit as number) : DEFAULT_LIMIT;
  const safeOffset = Number.isInteger(offset) && (offset as number) >= 0 ? (offset as number) : 0;
  return { limit: safeLimit, offset: safeOffset };
}

function toGroup(group: PharmacyGroupRow): PharmacyGroup {
  return {
    ...group,
    createdAt: group.createdAt ?? '',
    updatedAt: group.updatedAt ?? '',
  };
}

function toMember(member: GroupMemberRow): GroupMember {
  return {
    ...member,
    joinedAt: member.joinedAt ?? '',
  };
}

async function getGroupById(groupId: number): Promise<PharmacyGroupRow> {
  const [group] = await db.select()
    .from(pharmacyGroups)
    .where(eq(pharmacyGroups.id, groupId));

  if (!group) {
    throw new Error('グループが見つかりません');
  }

  return group;
}

async function getMembership(groupId: number, pharmacyId: number): Promise<GroupMemberRow | null> {
  const [membership] = await db.select()
    .from(groupMembers)
    .where(and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.pharmacyId, pharmacyId),
    ));

  return membership ?? null;
}

async function getActorRole(groupId: number, pharmacyId: number): Promise<GroupMemberRole> {
  const membership = await getMembership(groupId, pharmacyId);
  if (!membership) {
    throw new Error('グループメンバーではありません');
  }
  return membership.role;
}

function ensureOwnerOrAdmin(role: GroupMemberRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw new Error('招待できるのはオーナーまたは管理者のみです');
  }
}

async function assertCanViewGroup(group: PharmacyGroupRow, pharmacyId: number): Promise<void> {
  if (group.visibility === 'public') {
    return;
  }

  const membership = await getMembership(group.id, pharmacyId);
  if (!membership) {
    throw new Error('このグループを閲覧する権限がありません');
  }
}

export async function createGroup(pharmacyId: number, data: GroupCreateRequest): Promise<GroupDetailResponse> {
  const [createdGroup] = await db.insert(pharmacyGroups).values({
    name: data.name,
    description: data.description ?? null,
    visibility: data.visibility,
    ownerPharmacyId: pharmacyId,
  }).returning();

  if (!createdGroup) {
    throw new Error('グループ作成に失敗しました');
  }

  const [ownerMember] = await db.insert(groupMembers).values({
    groupId: createdGroup.id,
    pharmacyId,
    role: 'owner',
  }).returning();

  if (!ownerMember) {
    throw new Error('オーナーメンバーの作成に失敗しました');
  }

  return {
    ...toGroup(createdGroup),
    members: [toMember(ownerMember)],
    memberCount: 1,
  };
}

export async function updateGroup(
  groupId: number,
  pharmacyId: number,
  data: GroupUpdateRequest,
): Promise<GroupDetailResponse> {
  const group = await getGroupById(groupId);
  if (group.ownerPharmacyId !== pharmacyId) {
    throw new Error('グループオーナーのみ更新できます');
  }

  const [updatedGroup] = await db.update(pharmacyGroups)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pharmacyGroups.id, groupId))
    .returning();

  if (!updatedGroup) {
    throw new Error('グループ更新に失敗しました');
  }

  const membersResponse = await listMembers(groupId, pharmacyId, { limit: 1000, offset: 0 });
  return {
    ...toGroup(updatedGroup),
    members: membersResponse.members,
    memberCount: membersResponse.total,
  };
}

export async function deleteGroup(groupId: number, pharmacyId: number): Promise<void> {
  const group = await getGroupById(groupId);
  if (group.ownerPharmacyId !== pharmacyId) {
    throw new Error('グループオーナーのみ削除できます');
  }

  const deleted = await db.delete(pharmacyGroups)
    .where(eq(pharmacyGroups.id, groupId))
    .returning({ id: pharmacyGroups.id });

  if (deleted.length === 0) {
    throw new Error('グループ削除に失敗しました');
  }
}

export async function listGroups(pharmacyId: number, filters: ListGroupFilters = {}): Promise<GroupListResponse> {
  const { limit, offset } = normalizePaging(filters.limit, filters.offset);

  const memberRows = await db.select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.pharmacyId, pharmacyId));
  const memberGroupIds = memberRows.map((row) => row.groupId);

  const ownGroups = memberGroupIds.length > 0
    ? await db.select().from(pharmacyGroups).where(inArray(pharmacyGroups.id, memberGroupIds))
    : [];

  const publicGroups = memberGroupIds.length > 0
    ? await db.select().from(pharmacyGroups).where(and(
      eq(pharmacyGroups.visibility, 'public'),
      notInArray(pharmacyGroups.id, memberGroupIds),
    ))
    : await db.select().from(pharmacyGroups).where(eq(pharmacyGroups.visibility, 'public'));

  const deduped = [...ownGroups, ...publicGroups].reduce<Map<number, PharmacyGroupRow>>((map, group) => {
    map.set(group.id, group);
    return map;
  }, new Map());

  const groups = [...deduped.values()]
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

  return {
    groups: groups.slice(offset, offset + limit).map(toGroup),
    total: groups.length,
    offset,
    limit,
  };
}

export async function listMembers(
  groupId: number,
  pharmacyId: number,
  options: { limit?: number; offset?: number } = {},
): Promise<MemberListResponse> {
  const { limit, offset } = normalizePaging(options.limit, options.offset);
  const group = await getGroupById(groupId);
  await assertCanViewGroup(group, pharmacyId);

  const members = await db.select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(desc(groupMembers.joinedAt))
    .limit(limit)
    .offset(offset);

  const allMembers = await db.select({ id: groupMembers.id })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  return {
    members: members.map(toMember),
    total: allMembers.length,
    offset,
    limit,
  };
}

export async function getGroupDetail(
  groupId: number,
  pharmacyId: number,
  options: { limit?: number; offset?: number } = {},
): Promise<GroupDetailResponse> {
  const { limit, offset } = normalizePaging(options.limit, options.offset);
  const group = await getGroupById(groupId);
  await assertCanViewGroup(group, pharmacyId);

  const members = await db.select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(desc(groupMembers.joinedAt))
    .limit(limit)
    .offset(offset);

  const allMembers = await db.select({ id: groupMembers.id })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  return {
    ...toGroup(group),
    members: members.map(toMember),
    memberCount: allMembers.length,
  };
}

export async function inviteMember(
  groupId: number,
  inviterPharmacyId: number,
  inviteePharmacyId: number,
): Promise<void> {
  if (inviterPharmacyId === inviteePharmacyId) {
    throw new Error('自分自身は招待できません');
  }

  const inviterRole = await getActorRole(groupId, inviterPharmacyId);
  ensureOwnerOrAdmin(inviterRole);

  const inviteeMembership = await getMembership(groupId, inviteePharmacyId);
  if (inviteeMembership) {
    throw new Error('既にグループメンバーです');
  }

  const [existingInvitation] = await db.select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, inviteePharmacyId),
      eq(notifications.type, 'group_invitation'),
      eq(notifications.referenceId, groupId),
      eq(notifications.isRead, false),
    ));

  if (existingInvitation) {
    throw new Error('既に招待済みです');
  }

  await createNotification({
    pharmacyId: inviteePharmacyId,
    type: 'group_invitation',
    title: 'グループ招待',
    message: `グループID:${groupId} に招待されています`,
    referenceType: 'request',
    referenceId: groupId,
  });

  await sendGroupPush(inviteePharmacyId, {
    title: 'グループ招待',
    body: `グループID:${groupId} に招待されています`,
    data: {
      url: '/groups',
      type: 'group_invitation',
      referenceId: String(groupId),
    },
  });
}

export async function acceptInvitation(groupId: number, pharmacyId: number): Promise<void> {
  const membership = await getMembership(groupId, pharmacyId);
  if (membership) {
    throw new Error('既にグループメンバーです');
  }

  const [invitation] = await db.select()
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.type, 'group_invitation'),
      eq(notifications.referenceId, groupId),
      eq(notifications.isRead, false),
    ));

  if (!invitation) {
    throw new Error('有効な招待が見つかりません');
  }

  const [createdMember] = await db.insert(groupMembers).values({
    groupId,
    pharmacyId,
    role: 'member',
  }).returning();

  if (!createdMember) {
    throw new Error('グループ参加に失敗しました');
  }

  await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(eq(notifications.id, invitation.id))
    .returning({ id: notifications.id });

  const group = await getGroupById(groupId);
  if (group.ownerPharmacyId !== pharmacyId) {
    await sendGroupPush(group.ownerPharmacyId, {
      title: 'グループ参加',
      body: `薬局ID:${pharmacyId} がグループに参加しました`,
      data: {
        url: `/groups/${groupId}`,
        type: 'group_joined',
        referenceId: String(groupId),
      },
    });
  }
}

export async function joinPublicGroup(groupId: number, pharmacyId: number): Promise<void> {
  const group = await getGroupById(groupId);
  if (group.visibility !== 'public') {
    throw new Error('公開グループではないため参加できません');
  }

  const membership = await getMembership(groupId, pharmacyId);
  if (membership) {
    throw new Error('既にグループメンバーです');
  }

  const [createdMember] = await db.insert(groupMembers).values({
    groupId,
    pharmacyId,
    role: 'member',
  }).returning();

  if (!createdMember) {
    throw new Error('グループ参加に失敗しました');
  }

  if (group.ownerPharmacyId !== pharmacyId) {
    await sendGroupPush(group.ownerPharmacyId, {
      title: 'グループ参加',
      body: `薬局ID:${pharmacyId} がグループに参加しました`,
      data: {
        url: `/groups/${groupId}`,
        type: 'group_joined',
        referenceId: String(groupId),
      },
    });
  }
}

export async function declineInvitation(groupId: number, pharmacyId: number): Promise<void> {
  const [invitation] = await db.select()
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.type, 'group_invitation'),
      eq(notifications.referenceId, groupId),
      eq(notifications.isRead, false),
    ));

  if (!invitation) {
    throw new Error('有効な招待が見つかりません');
  }

  await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(eq(notifications.id, invitation.id))
    .returning({ id: notifications.id });
}

export async function removeMember(
  groupId: number,
  actorPharmacyId: number,
  targetPharmacyId: number,
): Promise<void> {
  if (actorPharmacyId === targetPharmacyId) {
    throw new Error('自身を削除する場合は脱退機能を利用してください');
  }

  const actorRole = await getActorRole(groupId, actorPharmacyId);
  ensureOwnerOrAdmin(actorRole);

  const targetMembership = await getMembership(groupId, targetPharmacyId);
  if (!targetMembership) {
    throw new Error('対象メンバーが見つかりません');
  }
  if (targetMembership.role === 'owner') {
    throw new Error('オーナーは削除できません');
  }

  const deleted = await db.delete(groupMembers)
    .where(and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.pharmacyId, targetPharmacyId),
    ))
    .returning({ id: groupMembers.id });

  if (deleted.length === 0) {
    throw new Error('メンバー削除に失敗しました');
  }
}

export async function leaveGroup(groupId: number, pharmacyId: number): Promise<void> {
  const membership = await getMembership(groupId, pharmacyId);
  if (!membership) {
    throw new Error('グループメンバーではありません');
  }
  if (membership.role === 'owner') {
    throw new Error('オーナーはグループを脱退できません');
  }

  const deleted = await db.delete(groupMembers)
    .where(and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.pharmacyId, pharmacyId),
    ))
    .returning({ id: groupMembers.id });

  if (deleted.length === 0) {
    throw new Error('グループ脱退に失敗しました');
  }

  const group = await getGroupById(groupId);
  if (group.ownerPharmacyId !== pharmacyId) {
    await sendGroupPush(group.ownerPharmacyId, {
      title: 'グループ脱退',
      body: `薬局ID:${pharmacyId} がグループを脱退しました`,
      data: {
        url: `/groups/${groupId}`,
        type: 'group_left',
        referenceId: String(groupId),
      },
    });
  }
}

export async function updateMemberRole(
  groupId: number,
  actorPharmacyId: number,
  targetPharmacyId: number,
  role: GroupMemberRole,
): Promise<GroupMember> {
  const actorRole = await getActorRole(groupId, actorPharmacyId);
  ensureOwnerOrAdmin(actorRole);

  const targetMembership = await getMembership(groupId, targetPharmacyId);
  if (!targetMembership) {
    throw new Error('対象メンバーが見つかりません');
  }
  if (targetMembership.role === 'owner') {
    throw new Error('オーナーのロールは変更できません');
  }

  const [updatedMember] = await db.update(groupMembers)
    .set({ role })
    .where(and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.pharmacyId, targetPharmacyId),
      or(
        eq(groupMembers.role, 'admin'),
        eq(groupMembers.role, 'member'),
      ),
    ))
    .returning();

  if (!updatedMember) {
    throw new Error('メンバーロール更新に失敗しました');
  }

  return toMember(updatedMember);
}
