import { and, desc, eq, gte, ilike, inArray, lte, sql, SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawStatusEnum, openclawWorkItems, pharmacies, userRequests } from '../db/schema';
import { rowCount } from '../utils/db-utils';
import {
  computeRequestWaitingState,
  hasAdminUnreadMessages,
} from './request-collaboration-service';

export interface UserRequestListParams {
  page: number;
  limit: number;
  offset: number;
  status?: string;
  pharmacyId?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  category?: string;
  priority?: string;
  assignedAdminId?: number;
  onlyUnread?: boolean;
  waitingOn?: 'user' | 'admin' | 'openclaw';
}

export interface AdminUserRequestListItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  requestText: string;
  category: string;
  priority: string;
  closeReason: string | null;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  workflowStatus: string | null;
  latestSummary: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  requesterLastViewedAt: string | null;
  adminLastViewedAt: string | null;
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  hasUnread: boolean;
  waitingOn: 'user' | 'admin' | 'openclaw' | null;
  isOverdue: boolean;
}

export async function listUserRequests(params: UserRequestListParams) {
  const conditions: SQL[] = [];
  if (params.status) {
    conditions.push(eq(
      userRequests.openclawStatus,
      params.status as (typeof openclawStatusEnum.enumValues)[number],
    ));
  }
  if (params.pharmacyId) {
    conditions.push(eq(userRequests.pharmacyId, params.pharmacyId));
  }
  if (params.dateFrom) {
    conditions.push(gte(userRequests.createdAt, params.dateFrom));
  }
  if (params.dateTo) {
    conditions.push(lte(userRequests.createdAt, params.dateTo));
  }
  if (params.category) {
    conditions.push(eq(userRequests.category, params.category));
  }
  if (params.priority) {
    conditions.push(eq(userRequests.priority, params.priority));
  }
  if (params.assignedAdminId) {
    conditions.push(eq(userRequests.assignedAdminId, params.assignedAdminId));
  }
  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(ilike(userRequests.requestText, pattern));
  }
  if (params.onlyUnread) {
    conditions.push(sql`
      COALESCE(${userRequests.latestUserMessageAt}, to_timestamp(0)) >
      COALESCE(${userRequests.adminLastViewedAt}, to_timestamp(0))
    `);
  }
  if (params.waitingOn === 'user') {
    conditions.push(sql`
      (
        ${openclawWorkItems.workflowStatus} = 'awaiting_user'
        OR COALESCE(${userRequests.latestStaffMessageAt}, to_timestamp(0)) >
           COALESCE(${userRequests.latestUserMessageAt}, to_timestamp(0))
      )
    `);
  }
  if (params.waitingOn === 'admin') {
    conditions.push(sql`
      COALESCE(${userRequests.latestUserMessageAt}, to_timestamp(0)) >
      COALESCE(${userRequests.latestStaffMessageAt}, to_timestamp(0))
    `);
  }
  if (params.waitingOn === 'openclaw') {
    conditions.push(sql`
      ${openclawWorkItems.workflowStatus} IS NOT NULL
      AND ${openclawWorkItems.workflowStatus} <> 'completed'
      AND COALESCE(${userRequests.latestUserMessageAt}, to_timestamp(0)) =
          COALESCE(${userRequests.latestStaffMessageAt}, to_timestamp(0))
    `);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [totalRow]] = await Promise.all([
    db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      pharmacyName: pharmacies.name,
      requestText: userRequests.requestText,
      category: userRequests.category,
      priority: userRequests.priority,
      closeReason: userRequests.closeReason,
      openclawStatus: userRequests.openclawStatus,
      openclawThreadId: userRequests.openclawThreadId,
      openclawSummary: userRequests.openclawSummary,
      assignedAdminId: userRequests.assignedAdminId,
      requesterLastViewedAt: userRequests.requesterLastViewedAt,
      adminLastViewedAt: userRequests.adminLastViewedAt,
      latestUserMessageAt: userRequests.latestUserMessageAt,
      latestStaffMessageAt: userRequests.latestStaffMessageAt,
      createdAt: userRequests.createdAt,
      updatedAt: userRequests.updatedAt,
      workflowStatus: openclawWorkItems.workflowStatus,
      latestSummary: openclawWorkItems.latestSummary,
      branchName: openclawWorkItems.branchName,
      prUrl: openclawWorkItems.prUrl,
      prNumber: openclawWorkItems.prNumber,
    })
      .from(userRequests)
      .leftJoin(pharmacies, eq(userRequests.pharmacyId, pharmacies.id))
      .leftJoin(openclawWorkItems, eq(openclawWorkItems.requestId, userRequests.id))
      .where(where)
      .orderBy(desc(userRequests.updatedAt), desc(userRequests.id))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount })
      .from(userRequests)
      .leftJoin(openclawWorkItems, eq(openclawWorkItems.requestId, userRequests.id))
      .where(where),
  ]);

  const assignedAdminIds = Array.from(new Set(rows
    .map((row) => row.assignedAdminId)
    .filter((value): value is number => typeof value === 'number' && value > 0)));

  const assignees = assignedAdminIds.length > 0
    ? await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
    })
      .from(pharmacies)
      .where(inArray(pharmacies.id, assignedAdminIds))
    : [];

  const assigneeMap = new Map(assignees.map((assignee) => [assignee.id, assignee.name]));

  const data = rows
    .map<AdminUserRequestListItem>((row) => {
      const waitingState = computeRequestWaitingState({
        latestUserMessageAt: row.latestUserMessageAt,
        latestStaffMessageAt: row.latestStaffMessageAt,
        workflowStatus: row.workflowStatus,
      });
      const hasUnread = hasAdminUnreadMessages({
        latestUserMessageAt: row.latestUserMessageAt,
        adminLastViewedAt: row.adminLastViewedAt,
      });

      return {
        ...row,
        category: row.category ?? 'improvement',
        priority: row.priority ?? 'normal',
        closeReason: row.closeReason ?? null,
        openclawStatus: row.openclawStatus ?? 'pending_handoff',
        workflowStatus: row.workflowStatus ?? null,
        latestSummary: row.latestSummary ?? null,
        branchName: row.branchName ?? null,
        prUrl: row.prUrl ?? null,
        prNumber: row.prNumber ?? null,
        assignedAdminId: row.assignedAdminId ?? null,
        assignedAdminName: row.assignedAdminId ? (assigneeMap.get(row.assignedAdminId) ?? null) : null,
        requesterLastViewedAt: row.requesterLastViewedAt ?? null,
        adminLastViewedAt: row.adminLastViewedAt ?? null,
        latestUserMessageAt: row.latestUserMessageAt ?? null,
        latestStaffMessageAt: row.latestStaffMessageAt ?? null,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
        hasUnread,
        waitingOn: waitingState.waitingOn,
        isOverdue: waitingState.isOverdue,
      };
    });

  return { data, total: totalRow.count };
}
