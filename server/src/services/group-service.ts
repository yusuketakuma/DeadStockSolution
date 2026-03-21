import { and, desc, eq, inArray, notInArray, or, type SQL } from 'drizzle-orm';
import { buildTokenizedSearchConditions } from '../utils/search-utils';
import { db } from '../config/database';
import { groupMembers, notifications, pharmacyGroups } from '../db/schema';
import type {
  GroupCreateRequest,
  GroupDetailResponse,
  GroupListResponse,
  GroupMembershipSummaryResponse,
  PharmacyGroup,
  GroupMember,
  GroupMemberRole,
  GroupUpdateRequest,
} from '../types/group';
import { createNotification } from './notification-service';
import { logger } from './logger';
import { sendToPharmacy } from './push-dispatch-service';
import { encodeCursor } from '../utils/cursor-pagination';

type PharmacyGroupRow = typeof pharmacyGroups.$inferSelect;
type GroupMemberRow = typeof groupMembers.$inferSelect;

export interface GroupCursor {
  id: number;
  createdAt: string;
}

export type GroupListTab = 'mine' | 'public';

interface ListGroupFilters {
  limit?: number;
  offset?: number;
  search?: string;
  cursor?: GroupCursor;
  tab?: GroupListTab;
}

interface MemberListResponse {
  members: GroupMember[];
  total: number;
  offset: number;
  limit: number;
}

interface NotificationIdRow {
  id: number;
}

const DEFAULT_LIMIT = 20;
const GROUP_MEMBER_BATCH_LIMIT = 1000 as const;

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

async function listGroupMembersPage(groupId: number, limit: number, offset: number): Promise<GroupMemberRow[]> {
  return db.select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(desc(groupMembers.joinedAt))
    .limit(limit)
    .offset(offset);
}

async function countGroupMembers(groupId: number): Promise<number> {
  const allMembers = await db.select({ id: groupMembers.id })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return allMembers.length;
}

function memberCondition(groupId: number, pharmacyId: number): ReturnType<typeof and> {
  return and(
    eq(groupMembers.groupId, groupId),
    eq(groupMembers.pharmacyId, pharmacyId),
  );
}

async function findUnreadGroupInvitation(groupId: number, pharmacyId: number): Promise<NotificationIdRow | null> {
  const [invitation] = await db.select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.type, 'group_invitation'),
      eq(notifications.referenceId, groupId),
      eq(notifications.isRead, false),
    ));
  return invitation ?? null;
}

async function createGroupMemberOrThrow(groupId: number, pharmacyId: number, role: GroupMemberRole): Promise<GroupMemberRow> {
  const [createdMember] = await db.insert(groupMembers).values({
    groupId,
    pharmacyId,
    role,
  }).returning();

  if (!createdMember) {
    throw new Error('グループ参加に失敗しました');
  }

  return createdMember;
}

async function markNotificationAsRead(notificationId: number): Promise<void> {
  await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(eq(notifications.id, notificationId))
    .returning({ id: notifications.id });
}

async function notifyGroupOwnerMembershipChange(
  ownerPharmacyId: number,
  actorPharmacyId: number,
  groupId: number,
  event: 'group_joined' | 'group_left',
): Promise<void> {
  if (ownerPharmacyId === actorPharmacyId) {
    return;
  }

  const joined = event === 'group_joined';
  await sendGroupPush(ownerPharmacyId, {
    title: joined ? 'グループ参加' : 'グループ脱退',
    body: joined
      ? `薬局ID:${actorPharmacyId} がグループに参加しました`
      : `薬局ID:${actorPharmacyId} がグループを脱退しました`,
    data: {
      url: `/groups/${groupId}`,
      type: event,
      referenceId: String(groupId),
    },
  });
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
    .where(memberCondition(groupId, pharmacyId));

  return membership ?? null;
}

async function assertNotMember(groupId: number, pharmacyId: number): Promise<void> {
  const membership = await getMembership(groupId, pharmacyId);
  if (membership) {
    throw new Error('既にグループメンバーです');
  }
}

async function getUnreadInvitationOrThrow(groupId: number, pharmacyId: number): Promise<NotificationIdRow> {
  const invitation = await findUnreadGroupInvitation(groupId, pharmacyId);
  if (!invitation) {
    throw new Error('有効な招待が見つかりません');
  }
  return invitation;
}

async function deleteMembershipOrThrow(groupId: number, pharmacyId: number, errorMessage: string): Promise<void> {
  const deleted = await db.delete(groupMembers)
    .where(memberCondition(groupId, pharmacyId))
    .returning({ id: groupMembers.id });

  if (deleted.length === 0) {
    throw new Error(errorMessage);
  }
}

function dedupeAndSortGroups(ownGroups: PharmacyGroupRow[], publicGroups: PharmacyGroupRow[]): PharmacyGroupRow[] {
  const deduped = [...ownGroups, ...publicGroups].reduce<Map<number, PharmacyGroupRow>>((map, group) => {
    map.set(group.id, group);
    return map;
  }, new Map());

  return sortGroups([...deduped.values()]);
}

function sortGroups(groups: PharmacyGroupRow[]): PharmacyGroupRow[] {
  return [...groups].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
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

  const membersResponse = await listMembers(groupId, pharmacyId, { limit: GROUP_MEMBER_BATCH_LIMIT, offset: 0 });
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

  const searchCondition = filters.search
    ? buildTokenizedSearchConditions(filters.search, [pharmacyGroups.name, pharmacyGroups.description])
    : undefined;

  const memberRows = await db.select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.pharmacyId, pharmacyId));
  const memberGroupIds = memberRows.map((row) => row.groupId);

  const ownConditions: SQL[] = [];
  if (memberGroupIds.length > 0) ownConditions.push(inArray(pharmacyGroups.id, memberGroupIds));
  if (searchCondition) ownConditions.push(searchCondition);

  const ownGroups = filters.tab === 'public' || memberGroupIds.length === 0
    ? []
    : await db.select().from(pharmacyGroups).where(and(...ownConditions));

  const publicConditions: SQL[] = [eq(pharmacyGroups.visibility, 'public')];
  if (memberGroupIds.length > 0) publicConditions.push(notInArray(pharmacyGroups.id, memberGroupIds));
  if (searchCondition) publicConditions.push(searchCondition);

  const publicGroups = filters.tab === 'mine'
    ? []
    : await db.select().from(pharmacyGroups)
      .where(and(...publicConditions))
      .limit(500);

  const groups = filters.tab === 'mine'
    ? sortGroups(ownGroups)
    : filters.tab === 'public'
      ? sortGroups(publicGroups)
      : dedupeAndSortGroups(ownGroups, publicGroups);

  if (filters.cursor) {
    const cursor = filters.cursor;
    // cursor-based: find position after cursor in the sorted list (desc by createdAt, then id)
    const cursorIdx = groups.findIndex(
      (g) => g.id === cursor.id && g.createdAt === cursor.createdAt,
    );
    // If cursor not found, start from beginning (stale cursor)
    const startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
    const pageGroups = groups.slice(startIdx, startIdx + limit + 1);
    const hasMore = pageGroups.length > limit;
    const items = hasMore ? pageGroups.slice(0, limit) : pageGroups;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? encodeCursor<GroupCursor>({ id: lastItem.id, createdAt: lastItem.createdAt ?? '' })
      : null;

    return {
      groups: items.map(toGroup),
      total: groups.length,
      offset: 0,
      limit,
      pagination: { mode: 'cursor', hasMore, nextCursor },
    };
  }

  return {
    groups: groups.slice(offset, offset + limit).map(toGroup),
    total: groups.length,
    offset,
    limit,
    pagination: { mode: 'offset', hasMore: offset + limit < groups.length, nextCursor: null },
  };
}

export async function getMembershipSummary(pharmacyId: number): Promise<GroupMembershipSummaryResponse> {
  const memberRows = await db.select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.pharmacyId, pharmacyId));

  const memberGroupIds = memberRows.map((row) => row.groupId);
  if (memberGroupIds.length === 0) {
    return { groups: [], groupPharmacyIds: [] };
  }

  const [groups, allMemberRows] = await Promise.all([
    db.select({
      id: pharmacyGroups.id,
      name: pharmacyGroups.name,
    })
      .from(pharmacyGroups)
      .where(inArray(pharmacyGroups.id, memberGroupIds)),
    db.select({
      groupId: groupMembers.groupId,
      pharmacyId: groupMembers.pharmacyId,
    })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, memberGroupIds)),
  ]);

  const memberIdsByGroup = new Map<number, number[]>();
  const allGroupPharmacyIds = new Set<number>();

  for (const row of allMemberRows) {
    const ids = memberIdsByGroup.get(row.groupId) ?? [];
    ids.push(row.pharmacyId);
    memberIdsByGroup.set(row.groupId, ids);
    allGroupPharmacyIds.add(row.pharmacyId);
  }

  return {
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberPharmacyIds: memberIdsByGroup.get(group.id) ?? [],
    })),
    groupPharmacyIds: [...allGroupPharmacyIds],
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

  const [members, total] = await Promise.all([
    listGroupMembersPage(groupId, limit, offset),
    countGroupMembers(groupId),
  ]);

  return {
    members: members.map(toMember),
    total,
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

  const [members, memberCount] = await Promise.all([
    listGroupMembersPage(groupId, limit, offset),
    countGroupMembers(groupId),
  ]);

  return {
    ...toGroup(group),
    members: members.map(toMember),
    memberCount,
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

  await assertNotMember(groupId, inviteePharmacyId);

  const existingInvitation = await findUnreadGroupInvitation(groupId, inviteePharmacyId);
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
  await assertNotMember(groupId, pharmacyId);
  const invitation = await getUnreadInvitationOrThrow(groupId, pharmacyId);

  await createGroupMemberOrThrow(groupId, pharmacyId, 'member');
  await markNotificationAsRead(invitation.id);

  const group = await getGroupById(groupId);
  await notifyGroupOwnerMembershipChange(group.ownerPharmacyId, pharmacyId, groupId, 'group_joined');
}

export async function joinPublicGroup(groupId: number, pharmacyId: number): Promise<void> {
  const group = await getGroupById(groupId);
  if (group.visibility !== 'public') {
    throw new Error('公開グループではないため参加できません');
  }

  await assertNotMember(groupId, pharmacyId);

  await createGroupMemberOrThrow(groupId, pharmacyId, 'member');
  await notifyGroupOwnerMembershipChange(group.ownerPharmacyId, pharmacyId, groupId, 'group_joined');
}

export async function declineInvitation(groupId: number, pharmacyId: number): Promise<void> {
  const invitation = await getUnreadInvitationOrThrow(groupId, pharmacyId);

  await markNotificationAsRead(invitation.id);
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

  await deleteMembershipOrThrow(groupId, targetPharmacyId, 'メンバー削除に失敗しました');
}

export async function leaveGroup(groupId: number, pharmacyId: number): Promise<void> {
  const membership = await getMembership(groupId, pharmacyId);
  if (!membership) {
    throw new Error('グループメンバーではありません');
  }
  if (membership.role === 'owner') {
    throw new Error('オーナーはグループを脱退できません');
  }

  await deleteMembershipOrThrow(groupId, pharmacyId, 'グループ脱退に失敗しました');

  const group = await getGroupById(groupId);
  await notifyGroupOwnerMembershipChange(group.ownerPharmacyId, pharmacyId, groupId, 'group_left');
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
