import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, real, numeric, boolean, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { exchangeStatusEnum } from './schema-common';
import { deadStockItems } from './schema-inventory';

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
  completedTotalValue: numeric('completed_total_value', { precision: 12, scale: 2 }),
}, (table) => ({
  idxExchangeProposalsAProposed: index('idx_exchange_proposals_a_proposed')
    .on(table.pharmacyAId, table.proposedAt),
  idxExchangeProposalsBProposed: index('idx_exchange_proposals_b_proposed')
    .on(table.pharmacyBId, table.proposedAt),
  idxExchangeProposalsStatusProposed: index('idx_exchange_proposals_status_proposed')
    .on(table.status, table.proposedAt),
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
