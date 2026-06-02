import { pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});

export const pharmacyRelationshipTypeEnum = pgEnum('pharmacy_relationship_type_enum', ['favorite', 'blocked']);
export const uploadTypeEnum = pgEnum('upload_type_enum', ['dead_stock', 'used_medication']);
export const uploadJobStatusEnum = pgEnum('upload_job_status_enum', ['pending', 'processing', 'completed', 'failed']);
export const exchangeStatusEnum = pgEnum('exchange_status_enum', [
  'proposed',
  'accepted_a',
  'accepted_b',
  'confirmed',
  'rejected',
  'completed',
  'cancelled',
]);
export const adminMessageTargetTypeEnum = pgEnum('admin_message_target_type_enum', ['all', 'pharmacy']);
export const openclawStatusEnum = pgEnum('openclaw_status_enum', [
  'pending_handoff',
  'in_dialogue',
  'implementing',
  'completed',
]);
export const openclawWorkItemTypeEnum = pgEnum('openclaw_work_item_type_enum', [
  'user_report',
  'incident_investigation',
  'verification_review',
]);
export const openclawWorkflowStatusEnum = pgEnum('openclaw_workflow_status_enum', [
  'queued',
  'analyzing',
  'awaiting_user',
  'implementing',
  'pr_opened',
  'completed',
  'failed',
]);
export const openclawMessageAuthorTypeEnum = pgEnum('openclaw_message_author_type_enum', [
  'user',
  'openclaw_agent',
  'system',
  'admin',
]);
export const openclawMessageTypeEnum = pgEnum('openclaw_message_type_enum', [
  'message',
  'question',
  'status_update',
  'pr_report',
]);
export const drugMasterSyncStatusEnum = pgEnum('drug_master_sync_status_enum', ['running', 'success', 'failed', 'partial']);
export const drugMasterRevisionTypeEnum = pgEnum('drug_master_revision_type_enum', ['price_revision', 'new_listing', 'delisting', 'transition']);
export const specialBusinessHoursTypeEnum = pgEnum('special_business_hours_type_enum', [
  'holiday_closed',
  'long_holiday_closed',
  'temporary_closed',
  'special_open',
]);
export const monthlyReportStatusEnum = pgEnum('monthly_report_status_enum', ['success', 'failed']);
export const pharmacyGroupVisibilityEnum = pgEnum('pharmacy_group_visibility_enum', ['public', 'invite_only']);
export const groupMemberRoleEnum = pgEnum('group_member_role_enum', ['owner', 'admin', 'member']);
export const equivalenceTypeEnum = pgEnum('equivalence_type_enum', ['brand_generic', 'generic_generic']);

export const systemEventSourceValues = ['runtime_error', 'unhandled_rejection', 'uncaught_exception', 'vercel_deploy'] as const;
export type SystemEventSource = (typeof systemEventSourceValues)[number];

export const systemEventLevelValues = ['info', 'warning', 'error'] as const;
export type SystemEventLevel = (typeof systemEventLevelValues)[number];

export const registrationReviewVerdictValues = ['approved', 'rejected'] as const;
export type RegistrationReviewVerdict = (typeof registrationReviewVerdictValues)[number];

export const adminAuditActionValues = ['verify', 'reject', 're-review', 'activate', 'deactivate'] as const;
export type AdminAuditAction = (typeof adminAuditActionValues)[number];

export const errorCodeCategoryValues = ['upload', 'auth', 'sync', 'system', 'openclaw'] as const;
export type ErrorCodeCategory = (typeof errorCodeCategoryValues)[number];

export const errorCodeSeverityValues = ['critical', 'error', 'warning', 'info'] as const;
export type ErrorCodeSeverity = (typeof errorCodeSeverityValues)[number];

export const notificationTypeValues = ['proposal_received', 'proposal_status_changed', 'new_comment', 'request_update', 'group_invitation', 'group_join', 'group_leave', 'alert_near_expiry', 'alert_excess_stock', 'alert_resolved', 'match_update', 'matching_refresh_complete'] as const;
export type NotificationType = (typeof notificationTypeValues)[number];

export const notificationReferenceTypeValues = ['proposal', 'match', 'comment', 'request', 'alert'] as const;
export type NotificationReferenceType = (typeof notificationReferenceTypeValues)[number];

export const predictiveAlertTypeValues = ['near_expiry', 'excess_stock'] as const;
export type PredictiveAlertType = (typeof predictiveAlertTypeValues)[number];
