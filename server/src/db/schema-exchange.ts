import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, real, numeric, boolean, timestamp, index, uniqueIndex, check, varchar } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { exchangeStatusEnum } from './schema-common';
import { deadStockItems } from './schema-inventory';

export const proposalTemplates = pgTable('proposal_templates', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  name: varchar('name', { length: 100 }).notNull(),
  targetPharmacyId: integer('target_pharmacy_id').notNull().references(() => pharmacies.id),
  itemsJson: text('items_json').notNull(), // JSON: [{drugName, quantity}]
  createdFromProposalId: integer('created_from_proposal_id').references(() => exchangeProposals.id),
  usageCount: integer('usage_count').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxTemplatesPharmacy: index('idx_proposal_templates_pharmacy').on(table.pharmacyId, table.updatedAt),
}));

export const directMessages = pgTable('direct_messages', {
  id: serial('id').primaryKey(),
  fromPharmacyId: integer('from_pharmacy_id').notNull().references(() => pharmacies.id),
  toPharmacyId: integer('to_pharmacy_id').notNull().references(() => pharmacies.id),
  body: text('body').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxDmToPharmacy: index('idx_dm_to_pharmacy').on(table.toPharmacyId, table.isRead),
  idxDmFromPharmacy: index('idx_dm_from_pharmacy').on(table.fromPharmacyId),
}));

export const directMessageAttachments = pgTable('direct_message_attachments', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id').notNull().references(() => directMessages.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  fileSize: integer('file_size').notNull(),
  contentBase64: text('content_base64').notNull(),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxDirectMessageAttachmentsMessageCreated: index('idx_direct_message_attachments_message_created')
    .on(table.messageId, table.createdAt),
}));

export const exchangeProposals = pgTable('exchange_proposals', {
  id: serial('id').primaryKey(),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  status: exchangeStatusEnum('status').notNull().default('proposed'),
  totalValueA: numeric('total_value_a', { precision: 12, scale: 2 }),
  totalValueB: numeric('total_value_b', { precision: 12, scale: 2 }),
  valueDifference: numeric('value_difference', { precision: 12, scale: 2 }),
  proposedAt: timestamp('proposed_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  expiresAt: timestamp('expires_at', { mode: 'string' }),
  expiryReminderSentAt: timestamp('expiry_reminder_sent_at', { mode: 'string' }),
  completedTotalValue: numeric('completed_total_value', { precision: 12, scale: 2 }),
}, (table) => ({
  idxExchangeProposalsAProposed: index('idx_exchange_proposals_a_proposed')
    .on(table.pharmacyAId, table.proposedAt),
  idxExchangeProposalsBProposed: index('idx_exchange_proposals_b_proposed')
    .on(table.pharmacyBId, table.proposedAt),
  idxExchangeProposalsStatusProposed: index('idx_exchange_proposals_status_proposed')
    .on(table.status, table.proposedAt),
  idxExchangeProposalsStatusExpires: index('idx_exchange_proposals_status_expires')
    .on(table.status, table.expiresAt),
  idxExchangeProposalsCompletedA: index('idx_exchange_proposals_completed_a')
    .on(table.pharmacyAId, table.completedAt)
    .where(sql`${table.status} = 'completed'`),
  idxExchangeProposalsCompletedB: index('idx_exchange_proposals_completed_b')
    .on(table.pharmacyBId, table.completedAt)
    .where(sql`${table.status} = 'completed'`),
}));

export const exchangeProposalItems = pgTable('exchange_proposal_items', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  deadStockItemId: integer('dead_stock_item_id').notNull().references(() => deadStockItems.id),
  fromPharmacyId: integer('from_pharmacy_id').notNull().references(() => pharmacies.id),
  toPharmacyId: integer('to_pharmacy_id').notNull().references(() => pharmacies.id),
  quantity: real('quantity').notNull(),
  yakkaValue: numeric('yakka_value', { precision: 12, scale: 2 }),
}, (table) => ({
  idxExchangeItemsProposal: index('idx_exchange_items_proposal').on(table.proposalId),
  chkQuantityPositive: check('chk_exchange_item_quantity', sql`${table.quantity} > 0`),
}));

export const proposalComments = pgTable('proposal_comments', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  authorPharmacyId: integer('author_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  readByRecipient: boolean('read_by_recipient').notNull().default(false),
}, (table) => ({
  idxProposalCommentsProposalCreated: index('idx_proposal_comments_proposal_created')
    .on(table.proposalId, table.createdAt),
  idxProposalCommentsAuthor: index('idx_proposal_comments_author')
    .on(table.authorPharmacyId, table.createdAt),
}));

export const exchangeFeedback = pgTable('exchange_feedback', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  fromPharmacyId: integer('from_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  toPharmacyId: integer('to_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxExchangeFeedbackProposalFromUnique: uniqueIndex('idx_exchange_feedback_proposal_from_unique')
    .on(table.proposalId, table.fromPharmacyId),
  idxExchangeFeedbackTarget: index('idx_exchange_feedback_target')
    .on(table.toPharmacyId, table.createdAt),
  chkExchangeFeedbackRating: check('chk_exchange_feedback_rating', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
}));

export const proposalCounterOffers = pgTable('proposal_counter_offers', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  proposerPharmacyId: integer('proposer_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  responderPharmacyId: integer('responder_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  summary: text('summary').notNull(),
  itemsJson: text('items_json').notNull(),
  responseNote: text('response_note'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  respondedAt: timestamp('responded_at', { mode: 'string' }),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxProposalCounterOffersProposalCreated: index('idx_proposal_counter_offers_proposal_created')
    .on(table.proposalId, table.createdAt),
  idxProposalCounterOffersResponderStatus: index('idx_proposal_counter_offers_responder_status')
    .on(table.responderPharmacyId, table.status, table.createdAt),
  chkProposalCounterOfferStatus: check('chk_proposal_counter_offer_status', sql`${table.status} IN ('pending','accepted','rejected','superseded')`),
}));
