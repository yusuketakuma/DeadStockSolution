import { pgTable, serial, text, integer, varchar, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { openclawStatusEnum } from './schema-common';

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
  openclawStatus: openclawStatusEnum('openclaw_status').notNull().default('pending_handoff'),
  openclawThreadId: text('openclaw_thread_id'),
  openclawSummary: text('openclaw_summary'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUserRequestsCreatedAt: index('idx_user_requests_created_at').on(table.createdAt),
  idxUserRequestsPharmacyCreated: index('idx_user_requests_pharmacy_created').on(table.pharmacyId, table.createdAt),
  idxUserRequestsStatusCreated: index('idx_user_requests_status_created').on(table.openclawStatus, table.createdAt),
}));
