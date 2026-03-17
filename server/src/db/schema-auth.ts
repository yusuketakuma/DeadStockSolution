import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, timestamp, boolean, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import {
  groupMemberRoleEnum,
  openclawStatusEnum,
  pharmacyGroupVisibilityEnum,
  registrationReviewVerdictValues,
} from './schema-common';
import { pharmacies } from './schema-pharmacy';

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

export const pharmacyRegistrationReviews = pgTable('pharmacy_registration_reviews', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  pharmacyName: text('pharmacy_name').notNull(),
  postalCode: text('postal_code').notNull(),
  prefecture: text('prefecture').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  fax: text('fax').notNull(),
  licenseNumber: text('license_number').notNull(),
  permitLicenseNumber: text('permit_license_number').notNull(),
  permitPharmacyName: text('permit_pharmacy_name').notNull(),
  permitAddress: text('permit_address').notNull(),
  verdict: text('verdict').$type<(typeof registrationReviewVerdictValues)[number]>().notNull(),
  screeningScore: integer('screening_score').notNull().default(0),
  screeningReasons: text('screening_reasons').notNull(),
  mismatchDetailsJson: text('mismatch_details_json'),
  createdPharmacyId: integer('created_pharmacy_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  registrationIp: text('registration_ip'),
  submittedAt: timestamp('submitted_at', { mode: 'string' }).defaultNow(),
  reviewedAt: timestamp('reviewed_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxRegistrationReviewsSubmitted: index('idx_registration_reviews_submitted')
    .on(table.submittedAt),
  idxRegistrationReviewsVerdictSubmitted: index('idx_registration_reviews_verdict_submitted')
    .on(table.verdict, table.submittedAt),
  idxRegistrationReviewsCreatedPharmacy: index('idx_registration_reviews_created_pharmacy')
    .on(table.createdPharmacyId),
  chkRegistrationReviewsVerdict: check('chk_registration_reviews_verdict', sql`${table.verdict} IN ('approved', 'rejected')`),
  chkRegistrationReviewsScore: check('chk_registration_reviews_score', sql`${table.screeningScore} >= 0 AND ${table.screeningScore} <= 100`),
}));

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxPasswordResetToken: uniqueIndex('idx_password_reset_token').on(table.token),
  idxPasswordResetPharmacy: index('idx_password_reset_pharmacy').on(table.pharmacyId),
  idxPasswordResetActiveTokens: index('idx_password_reset_active_tokens')
    .on(table.pharmacyId, table.expiresAt)
    .where(sql`${table.usedAt} IS NULL`),
}));

export const pharmacyGroups = pgTable('pharmacy_groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  visibility: pharmacyGroupVisibilityEnum('visibility').notNull().default('invite_only'),
  ownerPharmacyId: integer('owner_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ([
  index('idx_pharmacy_groups_owner').on(table.ownerPharmacyId),
  index('idx_pharmacy_groups_visibility').on(table.visibility),
]));

export const groupMembers = pgTable('group_members', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').notNull().references(() => pharmacyGroups.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  role: groupMemberRoleEnum('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { mode: 'string' }).defaultNow(),
}, (table) => ([
  uniqueIndex('idx_group_members_unique').on(table.groupId, table.pharmacyId),
  index('idx_group_members_group').on(table.groupId),
  index('idx_group_members_pharmacy').on(table.pharmacyId),
]));
