import { desc, eq, and, sql, SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacyGroups, groupMembers, pharmacies } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export interface GroupListParams {
  page: number;
  limit: number;
  offset: number;
  visibility?: string;
}

export async function listGroups(params: GroupListParams) {
  const conditions: SQL[] = [];
  if (params.visibility) {
    conditions.push(eq(pharmacyGroups.visibility, params.visibility as any));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const memberCountSq = db.select({
    groupId: groupMembers.groupId,
    memberCount: sql<number>`count(*)`.as('member_count'),
  })
    .from(groupMembers)
    .groupBy(groupMembers.groupId)
    .as('mc');

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: pharmacyGroups.id,
      name: pharmacyGroups.name,
      description: pharmacyGroups.description,
      visibility: pharmacyGroups.visibility,
      ownerPharmacyId: pharmacyGroups.ownerPharmacyId,
      ownerName: pharmacies.name,
      memberCount: sql<number>`coalesce(${memberCountSq.memberCount}, 0)`.as('member_count'),
      createdAt: pharmacyGroups.createdAt,
    })
      .from(pharmacyGroups)
      .leftJoin(pharmacies, eq(pharmacyGroups.ownerPharmacyId, pharmacies.id))
      .leftJoin(memberCountSq, eq(pharmacyGroups.id, memberCountSq.groupId))
      .where(where)
      .orderBy(desc(pharmacyGroups.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(pharmacyGroups).where(where),
  ]);

  return { data, total: totalRow.count };
}

export async function getGroupMembers(groupId: number) {
  return db.select({
    id: groupMembers.id,
    pharmacyId: groupMembers.pharmacyId,
    pharmacyName: pharmacies.name,
    role: groupMembers.role,
    joinedAt: groupMembers.joinedAt,
  })
    .from(groupMembers)
    .leftJoin(pharmacies, eq(groupMembers.pharmacyId, pharmacies.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(desc(groupMembers.joinedAt));
}

export async function removeGroupMember(groupId: number, pharmacyId: number): Promise<boolean> {
  const result = await db.delete(groupMembers)
    .where(and(
      eq(groupMembers.groupId, groupId),
      eq(groupMembers.pharmacyId, pharmacyId),
    ));
  return (result.rowCount ?? 0) > 0;
}
