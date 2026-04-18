import { pgTable, serial, text, integer, varchar, boolean, timestamp, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import {
  openclawMessageAuthorTypeEnum,
  openclawMessageTypeEnum,
  openclawStatusEnum,
  openclawWorkflowStatusEnum,
  openclawWorkItemTypeEnum,
} from './schema-common';

export const openclawCommands = pgTable('openclaw_commands', {
  id: serial('id').primaryKey(),
  commandName: varchar('command_name', { length: 64 }).notNull(),
  parameters: jsonb('parameters'),
  status: varchar('status', { length: 16 }).notNull(),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  openclawThreadId: varchar('openclaw_thread_id', { length: 255 }),
  signature: varchar('signature', { length: 255 }).notNull(),
  receivedAt: timestamp('received_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
}, (table) => ({
  idxOpenclawCommandsReceivedAt: index('idx_openclaw_commands_received_at').on(table.receivedAt),
  idxOpenclawCommandsStatus: index('idx_openclaw_commands_status').on(table.status),
  idxOpenclawCommandsName: index('idx_openclaw_commands_name').on(table.commandName),
}));

export const openclawCommandWhitelist = pgTable('openclaw_command_whitelist', {
  id: serial('id').primaryKey(),
  commandName: varchar('command_name', { length: 64 }).unique().notNull(),
  category: varchar('category', { length: 16 }).notNull(),
  descriptionJa: varchar('description_ja', { length: 255 }),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  parametersSchema: jsonb('parameters_schema'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});

export const userRequests = pgTable('user_requests', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  requestText: text('request_text').notNull(),
  category: varchar('category', { length: 32 }).notNull().default('improvement'),
  priority: varchar('priority', { length: 16 }).notNull().default('normal'),
  closeReason: varchar('close_reason', { length: 32 }),
  assignedAdminId: integer('assigned_admin_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  requesterLastViewedAt: timestamp('requester_last_viewed_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  adminLastViewedAt: timestamp('admin_last_viewed_at', { mode: 'string', withTimezone: true }),
  latestUserMessageAt: timestamp('latest_user_message_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  latestStaffMessageAt: timestamp('latest_staff_message_at', { mode: 'string', withTimezone: true }),
  closedAt: timestamp('closed_at', { mode: 'string', withTimezone: true }),
  openclawStatus: openclawStatusEnum('openclaw_status').notNull().default('pending_handoff'),
  openclawThreadId: text('openclaw_thread_id'),
  openclawSummary: text('openclaw_summary'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUserRequestsCreatedAt: index('idx_user_requests_created_at').on(table.createdAt),
  idxUserRequestsPharmacyCreated: index('idx_user_requests_pharmacy_created').on(table.pharmacyId, table.createdAt),
  idxUserRequestsStatusCreated: index('idx_user_requests_status_created').on(table.openclawStatus, table.createdAt),
  idxUserRequestsCategoryCreated: index('idx_user_requests_category_created').on(table.category, table.createdAt),
  idxUserRequestsPriorityCreated: index('idx_user_requests_priority_created').on(table.priority, table.createdAt),
  idxUserRequestsAssignedAdminCreated: index('idx_user_requests_assigned_admin_created').on(table.assignedAdminId, table.createdAt),
}));

export const openclawWorkItems = pgTable('openclaw_work_items', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => userRequests.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  workItemType: openclawWorkItemTypeEnum('work_item_type').notNull().default('user_report'),
  workflowStatus: openclawWorkflowStatusEnum('workflow_status').notNull().default('queued'),
  latestSummary: text('latest_summary'),
  lastQuestion: text('last_question'),
  branchName: text('branch_name'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  lastError: text('last_error'),
  metadataJson: text('metadata_json'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxOpenclawWorkItemsRequestUnique: uniqueIndex('idx_openclaw_work_items_request_unique').on(table.requestId),
  idxOpenclawWorkItemsPharmacyStatus: index('idx_openclaw_work_items_pharmacy_status')
    .on(table.pharmacyId, table.workflowStatus, table.updatedAt),
  idxOpenclawWorkItemsStatusUpdated: index('idx_openclaw_work_items_status_updated')
    .on(table.workflowStatus, table.updatedAt),
}));

// openclawRequestEvents — ステータス遷移イベントログ（0037 migration）
export const openclawRequestEvents = pgTable('openclaw_request_events', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => userRequests.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  fromStatus: openclawStatusEnum('from_status'),
  toStatus: openclawStatusEnum('to_status'),
  threadId: text('thread_id'),
  summary: text('summary'),
  note: text('note'),
  metadataJson: jsonb('metadata_json'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  idxOpenclawRequestEventsRequestCreated: index('idx_openclaw_request_events_request_created').on(table.requestId, table.createdAt),
  idxOpenclawRequestEventsPharmacyCreated: index('idx_openclaw_request_events_pharmacy_created').on(table.pharmacyId, table.createdAt),
  idxOpenclawRequestEventsTypeCreated: index('idx_openclaw_request_events_type_created').on(table.eventType, table.createdAt),
}));

// openclawRetryJobs — ハンドオフ失敗リトライキュー（0037 migration）
export const openclawRetryJobs = pgTable('openclaw_retry_jobs', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => userRequests.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextRetryAt: timestamp('next_retry_at', { mode: 'string' }).defaultNow().notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  lastError: text('last_error'),
  triggerReason: text('trigger_reason'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  uqOpenclawRetryJobsRequestId: uniqueIndex('uq_openclaw_retry_jobs_request_id').on(table.requestId),
  idxOpenclawRetryJobsStatusNextRetry: index('idx_openclaw_retry_jobs_status_next_retry').on(table.status, table.nextRetryAt),
  idxOpenclawRetryJobsPharmacyCreated: index('idx_openclaw_retry_jobs_pharmacy_created').on(table.pharmacyId, table.createdAt),
}));

export const openclawRunbookLogs = pgTable('openclaw_runbook_logs', {
  id: serial('id').primaryKey(),
  adminId: integer('admin_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 128 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('success'),
  detail: text('detail'),
  resultSummary: text('result_summary'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxOpenclawRunbookLogsCreated: index('idx_openclaw_runbook_logs_created').on(table.createdAt),
  idxOpenclawRunbookLogsAdminCreated: index('idx_openclaw_runbook_logs_admin_created').on(table.adminId, table.createdAt),
}));

// DDS agent 関連テーブル
export const ddsBootstrapTokens = pgTable('dds_bootstrap_tokens', {
  id: serial('id').primaryKey(),
  environment: varchar('environment', { length: 32 }).notNull(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull(),
  requestedByAdminId: integer('requested_by_admin_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { mode: 'string', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
});

export const ddsAgentConnections = pgTable('dds_agent_connections', {
  id: serial('id').primaryKey(),
  agentId: varchar('agent_id', { length: 128 }).notNull(),
  agentName: varchar('agent_name', { length: 128 }),
  deviceLabel: varchar('device_label', { length: 128 }),
  environment: varchar('environment', { length: 32 }).notNull(),
  controlTokenHash: varchar('control_token_hash', { length: 128 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('active'),
  metadataJson: jsonb('metadata_json'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { mode: 'string', withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { mode: 'string', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  registeredAt: timestamp('registered_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uqDdsAgentConnectionsAgentEnv: uniqueIndex('uq_dds_agent_connections_agent_env').on(table.agentId, table.environment),
}));

export const ddsAgentJobs = pgTable('dds_agent_jobs', {
  id: serial('id').primaryKey(),
  agentId: varchar('agent_id', { length: 128 }),
  environment: varchar('environment', { length: 32 }).notNull(),
  workItemId: integer('work_item_id').references(() => ddsWorkItems.id, { onDelete: 'set null' }),
  jobType: varchar('job_type', { length: 64 }).notNull(),
  payload: jsonb('payload'),
  payloadJson: jsonb('payload_json'),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  result: jsonb('result'),
  attemptCount: integer('attempt_count').notNull().default(0),
  leaseTokenHash: varchar('lease_token_hash', { length: 128 }),
  leaseExpiresAt: timestamp('lease_expires_at', { mode: 'string', withTimezone: true }),
  leasedAt: timestamp('leased_at', { mode: 'string', withTimezone: true }),
  completedAt: timestamp('completed_at', { mode: 'string', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxDdsAgentJobsAgentStatus: index('idx_dds_agent_jobs_agent_status').on(table.agentId, table.status, table.createdAt),
  idxDdsAgentJobsWorkItem: index('idx_dds_agent_jobs_work_item').on(table.workItemId),
}));

export const ddsWorkItems = pgTable('dds_work_items', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').references(() => userRequests.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull().default('product_update'),
  workItemType: varchar('work_item_type', { length: 32 }).notNull().default('product_update'),
  workflowStatus: varchar('workflow_status', { length: 32 }).notNull().default('queued'),
  requestText: text('request_text'),
  latestSummary: text('latest_summary'),
  resultSummary: text('result_summary'),
  lastQuestion: text('last_question'),
  branchName: text('branch_name'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  lastError: text('last_error'),
  metadataJson: text('metadata_json'),
  contextJson: jsonb('context_json'),
  source: varchar('source', { length: 64 }),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uqDdsWorkItemsRequestId: uniqueIndex('uq_dds_work_items_request_id').on(table.requestId),
  idxDdsWorkItemsPharmacyStatus: index('idx_dds_work_items_pharmacy_status').on(table.pharmacyId, table.workflowStatus, table.updatedAt),
}));

export const userRequestMessages = pgTable('user_request_messages', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => userRequests.id, { onDelete: 'cascade' }),
  authorType: varchar('author_type', { length: 32 }).notNull(),
  authorPharmacyId: integer('author_pharmacy_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  messageType: varchar('message_type', { length: 32 }).notNull().default('message'),
  body: text('body').notNull(),
  metadataJson: jsonb('metadata_json'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  idxUserRequestMessagesRequestCreated: index('idx_user_request_messages_request_created').on(table.requestId, table.createdAt),
}));

export const openclawRequestMessages = pgTable('openclaw_request_messages', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => userRequests.id, { onDelete: 'cascade' }),
  authorType: openclawMessageAuthorTypeEnum('author_type').notNull(),
  messageType: openclawMessageTypeEnum('message_type').notNull().default('message'),
  body: text('body').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxOpenclawRequestMessagesRequestCreated: index('idx_openclaw_request_messages_request_created')
    .on(table.requestId, table.createdAt),
  idxOpenclawRequestMessagesRequestAuthor: index('idx_openclaw_request_messages_request_author')
    .on(table.requestId, table.authorType, table.createdAt),
}));

export const requestMessageAttachments = pgTable('request_message_attachments', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id').notNull().references(() => openclawRequestMessages.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  fileSize: integer('file_size').notNull(),
  contentBase64: text('content_base64').notNull(),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxRequestMessageAttachmentsMessageCreated: index('idx_request_message_attachments_message_created')
    .on(table.messageId, table.createdAt),
}));

export const userRequestInternalNotes = pgTable('user_request_internal_notes', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => userRequests.id, { onDelete: 'cascade' }),
  authorAdminId: integer('author_admin_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxUserRequestInternalNotesRequestCreated: index('idx_user_request_internal_notes_request_created')
    .on(table.requestId, table.createdAt),
}));
